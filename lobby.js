// Lobby and multiplayer functionality
class LobbyManager {
    constructor(gameState) {
        this.gameState = gameState;
        this.isConnected = false;
        this.lobbyPets = new Map();
        this.tipNotifications = [];
    }

    async joinLobby() {
        if (!this.gameState.pet || this.isConnected) return;

        try {
            // Update presence with pet data
            await room.updatePresence({
                pet: {
                    name: this.gameState.pet.name,
                    image: this.gameState.pet.image,
                    level: this.gameState.pet.level,
                    happiness: this.gameState.pet.happiness,
                    isActive: true
                },
                lastSeen: Date.now()
            });

            this.isConnected = true;
            this.gameState.isInLobby = true;
            
            // Listen for presence updates (other players joining/leaving)
            room.subscribePresence((presence) => {
                this.updateLobbyPets(presence);
            });

            // Listen for tip events from other players
            room.onmessage = (event) => {
                this.handleLobbyEvent(event.data);
            };

            console.log('Joined pet lobby!');
        } catch (error) {
            console.error('Failed to join lobby:', error);
        }
    }

    async leaveLobby() {
        if (!this.isConnected) return;

        await room.updatePresence({
            pet: null,
            isActive: false
        });

        this.isConnected = false;
        this.gameState.isInLobby = false;
        console.log('Left pet lobby');
    }

    updateLobbyPets(presence) {
        this.lobbyPets.clear();
        
        Object.entries(presence).forEach(([clientId, data]) => {
            if (data.pet && data.pet.isActive && clientId !== room.clientId) {
                this.lobbyPets.set(clientId, {
                    ...data.pet,
                    owner: room.peers[clientId]?.username || 'Anonymous',
                    clientId
                });
            }
        });

        // Trigger UI update
        this.onLobbyUpdate?.(Array.from(this.lobbyPets.values()));
    }

    handleLobbyEvent(eventData) {
        switch (eventData.type) {
            case 'tip_received':
                this.handleLobbyTip(eventData);
                break;
            case 'pet_interaction':
                this.handlePetInteraction(eventData);
                break;
        }
    }

    handleLobbyTip(eventData) {
        // If someone else in the lobby receives a tip, give us a small bonus too
        if (eventData.clientId !== room.clientId) {
            const bonusAmount = Math.floor(eventData.amount * 0.1); // 10% of the tip
            this.gameState.applyTipBonus(bonusAmount);
            
            this.showTipNotification(`${eventData.username} received a tip! You gained a small bonus too! 🎉`);
        }
    }

    handlePetInteraction(eventData) {
        // Handle pet-to-pet interactions
        if (eventData.targetPet === this.gameState.pet.name) {
            this.gameState.pet.happiness = Math.min(100, this.gameState.pet.happiness + 5);
            this.showTipNotification(`${eventData.fromPet} played with ${this.gameState.pet.name}! +5 happiness`);
        }
    }

    async sendTipNotification(amount) {
        // Broadcast to lobby that we received a tip
        room.send({
            type: 'tip_received',
            amount: amount,
            username: room.peers[room.clientId]?.username || 'Someone',
            clientId: room.clientId,
            echo: false // Don't send to ourselves
        });
    }

    async interactWithPet(targetClientId, targetPetName) {
        if (!this.isConnected || !this.gameState.pet) return;

        // Send interaction to target pet
        room.send({
            type: 'pet_interaction',
            fromPet: this.gameState.pet.name,
            targetPet: targetPetName,
            targetClientId: targetClientId,
            interactionType: 'play'
        });

        // Cost energy for interaction
        this.gameState.pet.energy = Math.max(0, this.gameState.pet.energy - 5);
        this.gameState.pet.happiness = Math.min(100, this.gameState.pet.happiness + 3);
        this.gameState.saveToStorage();
    }

    showTipNotification(message) {
        // Create floating notification
        const notification = document.createElement('div');
        notification.className = 'tip-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(45deg, #00b894, #00cec9);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 10px;
            box-shadow: 0 5px 20px rgba(0, 184, 148, 0.3);
            z-index: 1001;
            animation: slideIn 0.5s ease, fadeOut 0.5s ease 3s forwards;
            max-width: 300px;
        `;

        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes fadeOut {
                to { opacity: 0; transform: translateX(100%); }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(notification);

        // Remove after animation
        setTimeout(() => {
            notification.remove();
            style.remove();
        }, 3500);
    }

    async updatePetInLobby() {
        if (!this.isConnected || !this.gameState.pet) return;

        await room.updatePresence({
            pet: {
                name: this.gameState.pet.name,
                image: this.gameState.pet.image,
                level: this.gameState.pet.level,
                happiness: this.gameState.pet.happiness,
                isActive: true
            },
            lastSeen: Date.now()
        });
    }
}

// Initialize lobby manager when game loads
let lobbyManager;

document.addEventListener('DOMContentLoaded', () => {
    // Wait for gameState to be available
    setTimeout(() => {
        if (typeof gameState !== 'undefined') {
            lobbyManager = new LobbyManager(gameState);
            
            // Auto-join lobby if pet exists
            if (gameState.pet) {
                lobbyManager.joinLobby();
            }

            // Listen for tip events from comments
            window.websim.addEventListener('comment:created', (data) => {
                const comment = data.comment;
                if (comment.card_data && comment.card_data.type === 'tip_comment') {
                    // Notify lobby about tip
                    lobbyManager.sendTipNotification(comment.card_data.credits_spent);
                }
            });

            // Update lobby pet data periodically
            setInterval(() => {
                if (lobbyManager.isConnected && gameState.pet) {
                    lobbyManager.updatePetInLobby();
                }
            }, 30000); // Every 30 seconds
        }
    }, 1000);
});

// Export for use in other files
window.lobbyManager = lobbyManager;

