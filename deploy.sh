#!/bin/bash

# WC3 Connector Server Deploy Script for Ubuntu
# Runs on: 1 vCPU, 1GB RAM, 10GB SSD

set -e

echo "🚀 WC3 Connector Server Deployment"

# 1. Update system
echo "📦 Updating system..."
sudo apt-get update
sudo apt-get upgrade -y

# 2. Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install PM2 (process manager)
echo "📦 Installing PM2..."
sudo npm install -g pm2

# 4. Create app directory
echo "📁 Creating app directory..."
sudo mkdir -p /opt/wc3-connector
sudo chown $USER:$USER /opt/wc3-connector
cd /opt/wc3-connector

# 5. Clone repository (or manually upload files)
echo "📥 Cloning repository..."
# Replace with your actual repo URL
git clone <YOUR_REPO_URL> .

# 6. Install dependencies
echo "📦 Installing dependencies..."
cd server
npm install --production
npm run build

# 7. Create .env file
echo "🔧 Creating .env file..."
cat > .env << EOF
PORT=3000
HOST=0.0.0.0
JWT_SECRET=$(openssl rand -base64 32)
NODE_ENV=production
EOF

echo "✅ .env created with JWT_SECRET:"
grep JWT_SECRET .env

# 8. Start with PM2
echo "🚀 Starting server with PM2..."
pm2 start dist/index.js --name "wc3-server" --instances 1 --exec-mode cluster
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER

# 9. Configure firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 3000/tcp  # App port
sudo ufw enable

# 10. Test server
echo "🧪 Testing server..."
sleep 2
curl http://localhost:3000/health || echo "⚠️ Server may still be starting..."

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "📋 Server Details:"
echo "   Location: /opt/wc3-connector/server"
echo "   Process Manager: PM2"
echo "   Port: 3000"
echo "   Public URL: http://$(curl -s ifconfig.me):3000"
echo ""
echo "🔗 Useful Commands:"
echo "   pm2 logs wc3-server         # View logs"
echo "   pm2 restart wc3-server      # Restart"
echo "   pm2 stop wc3-server         # Stop"
echo "   pm2 delete wc3-server       # Remove"
echo ""
echo "⚠️ IMPORTANT: Update your connector config to use:"
echo "   ws://$(curl -s ifconfig.me):3000/ws"
