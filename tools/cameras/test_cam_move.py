# Will Gardiner's pan/tilt smoke test for both Reolink cameras (shared 2026-10-18). Prompts for the camera password.

import getpass
import json
import ssl
import time
import urllib.request

password = getpass.getpass("Camera password: ")

# Accept the cameras' self-signed HTTPS certificates.
context = ssl._create_unverified_context()

cameras = [
    ("Gallery", "192.168.8.103"),
    ("River", "192.168.8.217"),
]

for label, host in cameras:
    base = f"https://{host}/cgi-bin/api.cgi"

    def call(command, params, token=None):
        url = base + (
            "?token=" + token if token else "?cmd=Login"
        )
        body = [{
            "cmd": command,
            "action": 0,
            "param": params,
        }]
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )

        with urllib.request.urlopen(
            request, context=context, timeout=4
        ) as response:
            result = json.load(response)[0]

        if (
            result.get("code") != 0
            or result.get("value", {}).get("rspCode", 200) != 200
        ):
            raise RuntimeError(command + " rejected")

        return result

    token = call("Login", {
        "User": {
            "userName": "admin",
            "password": password,
        }
    })["value"]["Token"]["name"]

    def move(operation):
        call("PtzCtrl", {
            "channel": 0,
            "op": operation,
            "speed": 1,
        }, token)
        print(f"{label}: {operation} accepted", flush=True)

    try:
        for operation in ["Left", "Up", "Down", "Right"]:
            try:
                move(operation)
                time.sleep(0.6)
            finally:
                stopped = False
                for attempt in range(3):
                    try:
                        move("Stop")
                        stopped = True
                        break
                    except Exception:
                        pass

                if not stopped:
                    raise RuntimeError(
                        f"{label}: STOP NOT CONFIRMED; "
                        "use camera controls to stop movement"
                    )

            time.sleep(2 if operation == "Up" else 1)
    finally:
        try:
            call("Logout", {}, token)
        except Exception:
            pass

    print(f"{label}: movement and return complete", flush=True)
    time.sleep(2)
