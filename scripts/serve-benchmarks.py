#!/usr/bin/env python3
"""Serves benchmark apps on separate ports for QASE testing."""
import http.server, socketserver, os, sys

APPS = {
    9901: ('app1-crm.html', 'CRM App (SalesFlow)'),
    9902: ('app2-taskboard.html', 'TaskBoard App'),
    9903: ('app3-shop.html', 'ShopHub E-commerce'),
    9904: ('app4-analytics.html', 'MetricsPro Analytics'),
    9905: ('app5-marketing.html', 'SaaSLaunch Marketing'),
    9906: ('app6-contactvault.html', 'ContactVault (buggy — no persistence)'),
    9907: ('app7-contactvault-fixed.html', 'ContactVault FIXED (localStorage persistence)'),
}

BENCH_DIR = os.path.join(os.path.dirname(__file__), '..', '.drytis', 'benchmarks')

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.server.bench_file
        if os.path.exists(path):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            with open(path, 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_error(404)
    def log_message(self, *args):
        pass  # Suppress logs

servers = []
for port, (filename, name) in APPS.items():
    filepath = os.path.join(BENCH_DIR, filename)
    if not os.path.exists(filepath):
        print(f"SKIP {name}: {filepath} not found")
        continue
    handler = type('H', (Handler,), {})
    httpd = socketserver.TCPServer(("0.0.0.0", port), handler)
    httpd.bench_file = filepath
    import threading
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    servers.append(httpd)
    print(f"  {name}: http://localhost:{port}/")

print(f"\n{len(servers)} benchmark apps serving. Press Ctrl+C to stop.")
try:
    import time
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\nShutting down...")
    for s in servers:
        s.shutdown()
