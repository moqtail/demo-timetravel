# Time Travel in MOQ Conferencing

### Prerequisites

- Docker
- Local certificates

### Running the Time Travel Demo

```bash
# Install local CA
mkcert -install
mkcert -key-file cert/key.pem -cert-file cert/cert.pem localhost 127.0.0.1 ::1

# Run the Docker containers
docker compose up --build
```

**🚀 The app will be available at [http://localhost:5173](http://localhost:5173) by default.**

> [!NOTE]
> If not working, please check the notes in cert/README.md

## Sample Project Structure

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
