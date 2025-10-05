FROM node:alpine

WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --prefer-offline --no-audit --progress=false

# Copy source code and build
COPY . .
RUN npm run build

EXPOSE 5173

# Start the application in preview mode, accessible from any host
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0"]
