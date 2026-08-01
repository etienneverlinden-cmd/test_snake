from pathlib import Path

path = Path("/etc/caddy/Caddyfile")
text = path.read_text()
if "handle /api/deck/*" in text:
    print("already configured")
else:
    old = "\thandle /_snake_deploy {\n\t\treverse_proxy 127.0.0.1:8788\n\t}\n\thandle {"
    new = (
        "\thandle /_snake_deploy {\n"
        "\t\treverse_proxy 127.0.0.1:8788\n"
        "\t}\n"
        "\thandle /api/deck/* {\n"
        "\t\treverse_proxy 127.0.0.1:8790\n"
        "\t}\n"
        "\thandle {"
    )
    if old not in text:
        raise SystemExit("pattern not found")
    path.write_text(text.replace(old, new, 1))
    print("updated")
