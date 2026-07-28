from pathlib import Path

path = Path("/etc/caddy/Caddyfile")
text = path.read_text()
old = """# Serpent snake game — public static site on the server IP (does not touch HQ)
http://89.167.46.13 {
	handle /_snake_deploy {
		reverse_proxy 127.0.0.1:8788
	}
	handle {
		root * /var/www/snake
		encode gzip
		file_server
	}
}"""
new = """# Serpent snake game — domain + IP (does not touch HQ)
pragmatict.be, www.pragmatict.be, http://89.167.46.13 {
	handle /_snake_deploy {
		reverse_proxy 127.0.0.1:8788
	}
	handle {
		root * /var/www/snake
		encode gzip
		file_server
	}
}"""
if old not in text:
    raise SystemExit("snake block not found")
path.write_text(text.replace(old, new))
print("updated")
