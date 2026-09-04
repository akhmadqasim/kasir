# Header proxy bersama untuk semua location kasir.
# Disimpan terpisah supaya tidak ada duplikasi antara blok login dan blok utama.

proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header Connection        "";

# Cookie sesi memakai HttpOnly dan SameSite=Lax; jangan diubah di sisi proxy.
proxy_pass_header Set-Cookie;

# Matikan buffering supaya unduhan backup mengalir apa adanya.
proxy_buffering off;
