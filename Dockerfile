FROM node:20

# Install Python and necessary build tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create a virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Expose the Node port
EXPOSE 3000

# Set environment variable so the node server binds to the correct port
ENV PORT=3000

# Run concurrently
CMD ["npx", "concurrently", "\"PYTHON_PORT=5001 python3 app.py\"", "\"node server.js\""]
