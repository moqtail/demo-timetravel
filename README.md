# Time Travel in MOQ Conferencing

Time Travel uses the MOQT protocol to enable **low-latency video conferencing with rewind capability**, allowing participants to replay recent moments from another participant’s stream without interrupting the ongoing live session.

---

## Online Demo

Available at https://timetravel.moqtail.dev

## Research Paper

Available at [ACM DL](https://doi.org/10.1145/3793853.3798193)

## Run Locally

### Prerequisites

* **Docker**
* **Local Certificates**

### Running the Demo

```bash
# 1. Install the local CA.
mkcert -install

# 2. Generate certificate files for 'localhost', '127.0.0.1', and '::1'.
mkcert -key-file cert/key.pem -cert-file cert/cert.pem localhost 127.0.0.1 ::1

# 3. Run the Docker containers.
docker compose up --build
```

**The app will be available at http://localhost:4173 by default.**

> [!NOTE]
> If you experience issues with TLS certificates, please check the [README](cert/README.md) in the `cert` directory for troubleshooting steps.
