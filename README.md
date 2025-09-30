# Time Travel in MOQ Conferencing

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [npm](https://www.npmjs.com/)
- [MOQtail Relay](https://github.com/streaming-university/moqtail) running with valid certificates

### Running the Development Server

```bash
cd ./apps/client

# Install dependencies
npm install

# Run the development server
npm run dev
```

### Running the MOQtail Room Server

```bash
cd ./apps/room-server

# Install dependencies
npm install

# Run the development MOQtail Room Server
npm run start
# or
npm run dev # for nodemon hot-reload
```

The app will be available at [http://localhost:5173](http://localhost:5173) by default.

## 🛠️ Sample Project Structure

```
apps/client/

├── public
│   ├── ...
├── src
│   ├── App.tsx
│   ├── composables
│   │   └── useVideoPipeline.ts
│   ├── contexts
│   │   └── SessionContext.tsx
│   ├── index.css
│   ├── main.tsx
│   ├── pages
│   │   ├── JoinPage.tsx
│   │   └── SessionPage.tsx
│   ├── sockets
│   │   └── SocketContext.tsx
│   ├── startup.ts
│   ├── types
│   │   ├── AppSettings.ts
│   │   └── types.ts
│   ├── videoUtils.ts
│   ├── vite-env.d.ts
│   └── workers
│       ├── decoderWorker.ts
│       └── pcmPlayerProcessor.js
├── ...

```
