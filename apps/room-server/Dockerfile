FROM node:alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --prefer-offline --no-audit --progress=false

# Copy application source
COPY . .

# Expose application port
EXPOSE 3001

# Start the application
CMD ["npm", "run", "start"]