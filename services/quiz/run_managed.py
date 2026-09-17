"""Owned loopback server. Port comes from an already bound socket, avoiding reuse races."""
import json
import os
import signal
import socket
import sys
import threading
from pathlib import Path

import uvicorn


def main():
    if not os.environ.get("MANAGED_HOST_TOKEN"):
        raise SystemExit("Managed host token required")
    config = os.environ.get("BETTERLEARN_QUIZ_ENV_FILE")
    if not config or not Path(config).is_file() or not os.access(config, os.R_OK):
        raise SystemExit("Readable quiz.env required; refusing tutorial configuration defaults")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", int(os.environ.get("BETTERLEARN_QUIZ_PORT", "0"))))
    sock.listen(128)
    port = sock.getsockname()[1]
    os.environ["APP_PORT"] = str(port)
    # The owning Host holds stdin open. Exit if it dies without disposing us.
    def watch_parent():
        sys.stdin.buffer.read()
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"betterlearnQuizPort": port}), flush=True)
    server = uvicorn.Server(uvicorn.Config("app.main:app", host="127.0.0.1", port=port,
                                         proxy_headers=False, access_log=False))
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
