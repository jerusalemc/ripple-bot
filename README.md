# watch pricing and send alert


pm2 —-name "cc-base"  start ssmgr -x -- -c ss.yml


pm2 --interpreter /root/.nvm/v6.10.2/bin/node --name "cc-base" -f start ssmgr -x -- -c /root/.ssmgr/ss.yml

pm2 --interpreter /root/.nvm/v6.10.2/bin/node --name "cc-gui" -f start ssmgr -x -- -c /root/.ssmgr/webgui.yml



server {
    server_name tianyu.xyz;
    listen 443 ssl;

    server_name tianyu.xyz www.tianyu.xyz;

        ssl_certificate /etc/letsencrypt/live/tianyu.xyz/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/tianyu.xyz/privkey.pem;

location ~ /.well-known {
root /usr/share/nginx/html;
}
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name tianyu.xyz www.tianyu.xyz;
    return 301 https://$host$request_uri;
}# ripple-bot
