import pandas as pd
import numpy as np
import joblib
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.ensemble import RandomForestClassifier


# ==============================
# 1. Load Dataset
# ==============================

data = pd.read_csv("gesture_data.csv", header=None)

if data.shape[0] == 0:
    print("Dataset is empty. Collect data first.")
    exit()

print("Original Class Distribution:")
print(data.iloc[:, -1].value_counts())


# ==============================
# 2. Balance Dataset (SAFE VERSION)
# ==============================

label_column = data.columns[-1]

# Find smallest class size
min_samples = data[label_column].value_counts().min()

# Create balanced dataset
balanced_data = []

for label in data[label_column].unique():
    subset = data[data[label_column] == label]
    subset = subset.sample(min_samples, random_state=42)
    balanced_data.append(subset)

data = pd.concat(balanced_data).reset_index(drop=True)

print("\nBalanced Class Distribution:")
print(data[label_column].value_counts())


# ==============================
# 3. Separate Features and Labels
# ==============================

X = data.iloc[:, :-1]
y = data.iloc[:, -1]


# ==============================
# 4. Encode Labels
# ==============================

le = LabelEncoder()
y_encoded = le.fit_transform(y)


# ==============================
# 5. Feature Scaling
# ==============================

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)


# ==============================
# 6. Train/Test Split
# ==============================

X_train, X_test, y_train, y_test = train_test_split(
    X_scaled,
    y_encoded,
    test_size=0.2,
    random_state=42,
    stratify=y_encoded
)


# ==============================
# 7. Train Model (Random Forest)
# ==============================

model = RandomForestClassifier(
    n_estimators=300,
    max_depth=None,
    random_state=42
)

model.fit(X_train, y_train)


# ==============================
# 8. Evaluate
# ==============================

y_pred = model.predict(X_test)

accuracy = model.score(X_test, y_test)
print("\nAccuracy:", accuracy)

print("\nLabel Mapping:")
print(le.classes_)

print("\nClassification Report:")
print(classification_report(y_test, y_pred))


# ==============================
# 9. Confusion Matrix
# ==============================

cm = confusion_matrix(y_test, y_pred)

plt.figure(figsize=(10, 8))
sns.heatmap(
    cm,
    annot=True,
    fmt='d',
    xticklabels=le.classes_,
    yticklabels=le.classes_
)
plt.title("Confusion Matrix")
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.tight_layout()
plt.savefig("confusion_matrix.png")
plt.close()

print("\nConfusion matrix saved as confusion_matrix.png")


# ==============================
# 10. Save Model Files
# ==============================

joblib.dump(model, "gesture_model.pkl")
joblib.dump(le, "label_encoder.pkl")
joblib.dump(scaler, "scaler.pkl")

print("\nModel, encoder and scaler saved successfully.")