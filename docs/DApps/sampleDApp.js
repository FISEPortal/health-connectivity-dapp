
// Sample DApp that demonstrates secure access to Profile DID and wallet address
// This is hosted on the marketplace and loaded by Signet

export async function init(container, secureInterface) {
    console.log('Initializing Secure Profile Demo DApp');

    try {
        // Create the DApp UI
        container.innerHTML = `
      <div style="padding: 20px; font-family: Arial, sans-serif;">
        <h2>Secure Profile Access Demo</h2>
        <div id="profile-info" style="margin: 20px 0;">
          <p>Loading profile information...</p>
        </div>
        
        <div style="margin: 20px 0;">
          <h3>Inter-DApp Communication</h3>
          <div>
            <input type="text" id="message-input" placeholder="Enter message to broadcast" 
                   style="width: 300px; padding: 8px; margin-right: 10px;">
            <button id="broadcast-btn" style="padding: 8px 16px;">Broadcast Message</button>
          </div>
          <div id="messages" style="margin-top: 20px; padding: 10px; background: #f5f5f5; min-height: 100px;">
            <p>Messages from other DApps will appear here...</p>
          </div>
        </div>

        <div style="margin: 20px 0;">
          <h3>Permissions</h3>
          <div id="permissions-list"></div>
          <button id="request-permissions-btn" style="padding: 8px 16px; margin-top: 10px;">
            Request Additional Permissions
          </button>
        </div>
      </div>
    `;

        // Get profile information
        const profileDid = await secureInterface.getProfileDid();
        const walletAddress = await secureInterface.getWalletAddress();
        const sessionId = secureInterface.getSessionId();

        // Display profile info
        const profileInfoDiv = container.querySelector('#profile-info');
        profileInfoDiv.innerHTML = `
      <div style="background: #e8f5e8; padding: 15px; border-radius: 8px;">
        <h3>Profile Information</h3>
        <p><strong>DID:</strong> ${profileDid}</p>
        <p><strong>Wallet:</strong> ${walletAddress}</p>
        <p><strong>Session:</strong> ${sessionId}</p>
      </div>
    `;

        // Set up inter-DApp communication
        const communicationChannel = secureInterface.getCommunicationChannel();
        const messagesDiv = container.querySelector('#messages');

        // Subscribe to messages from other DApps
        const unsubscribe = communicationChannel.subscribe((message) => {
            const messageElement = document.createElement('div');
            messageElement.style.cssText = 'margin: 5px 0; padding: 8px; background: white; border-left: 3px solid #007cba;';
            messageElement.innerHTML = `
        <small style="color: #666;">${new Date(message.timestamp).toLocaleTimeString()} - From: ${message.from}</small><br>
        <strong>${JSON.stringify(message.payload)}</strong>
      `;
            messagesDiv.appendChild(messageElement);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });

        // Broadcast message functionality
        const broadcastBtn = container.querySelector('#broadcast-btn');
        const messageInput = container.querySelector('#message-input');

        broadcastBtn.addEventListener('click', async () => {
            const message = messageInput.value.trim();
            if (message) {
                await communicationChannel.broadcast({
                    text: message,
                    sender: 'Secure Profile Demo'
                });
                messageInput.value = '';
            }
        });

        // Display current permissions
        const displayPermissions = () => {
            const permissions = secureInterface.getPermissions();
            const permissionsDiv = container.querySelector('#permissions-list');
            permissionsDiv.innerHTML = permissions.map(p => `
        <div style="margin: 5px 0; padding: 5px; background: ${p.granted ? '#e8f5e8' : '#fee'};">
          <strong>${p.type}:</strong> ${p.granted ? 'Granted' : 'Denied'}
        </div>
      `).join('');
        };

        displayPermissions();

        // Request additional permissions
        const requestPermissionsBtn = container.querySelector('#request-permissions-btn');
        requestPermissionsBtn.addEventListener('click', async () => {
            try {
                const newPermissions = await secureInterface.requestPermissions([
                    'wallet:access',
                    'dapp:communicate',
                    'profile:write'
                ]);

                console.log('New permissions:', newPermissions);
                displayPermissions();
            } catch (error) {
                console.error('Failed to request permissions:', error);
                alert('Failed to request permissions: ' + error.message);
            }
        });

        // Demonstrate direct messaging to another DApp (if any are running)
        setTimeout(async () => {
            try {
                await communicationChannel.sendDirect('another-dapp-uuid', {
                    greeting: 'Hello from Secure Profile Demo!',
                    timestamp: Date.now()
                });
            } catch (error) {
                console.log('No other DApps running for direct messaging');
            }
        }, 2000);

        console.log('Secure Profile Demo DApp initialized successfully');

        // Cleanup function (optional)
        return () => {
            unsubscribe();
            console.log('Secure Profile Demo DApp cleaned up');
        };

    } catch (error) {
        console.error('Failed to initialize DApp:', error);
        container.innerHTML = `
      <div style="padding: 20px; color: red;">
        <h2>Error</h2>
        <p>Failed to initialize DApp: ${error.message}</p>
      </div>
    `;
    }
}