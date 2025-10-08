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

**🚀 The app will be available at [http://localhost:4173](http://localhost:4173) by default.**

> [!NOTE]
> If you experience issues with TLS certificates, please check the [README](cert/README.md) in the `cert` directory for troubleshooting steps.
