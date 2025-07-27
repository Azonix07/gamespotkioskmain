FROM node:18

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json files
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install dependencies and rebuild sqlite3
RUN npm install
RUN cd backend && npm rebuild sqlite3 --build-from-source

# Copy the rest of the application
COPY . .

# Create data directory
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/gamespot.db

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
