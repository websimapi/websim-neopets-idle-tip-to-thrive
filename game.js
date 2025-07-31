const { useState, useEffect, useRef } = React;

// Initialize WebsimSocket for multiplayer and records
const room = new WebsimSocket();
await room.initialize();

// Game state management
class GameState {
    constructor() {
        this.money = 100;
        this.pet = null;
        this.tipMultiplier = 1.0;
        this.statusEffects = [];
        this.lastUpdate = Date.now();
        this.isInLobby = false;
    }

    async loadFromStorage() {
        const savedState = localStorage.getItem('neopet-game-state');
        if (savedState) {
            const data = JSON.parse(savedState);
            Object.assign(this, data);
            
            // Calculate offline progression
            if (this.pet && this.lastUpdate) {
                const timeDiff = Date.now() - this.lastUpdate;
                this.applyOfflineProgression(timeDiff);
            }
        }
    }

    saveToStorage() {
        this.lastUpdate = Date.now();
        localStorage.setItem('neopet-game-state', JSON.stringify(this));
    }

    applyOfflineProgression(timeDiff) {
        const hours = timeDiff / (1000 * 60 * 60);
        const rate = this.tipMultiplier;
        
        // Apply decay rates based on tip multiplier
        this.pet.happiness = Math.max(0, this.pet.happiness - (hours * 5 / rate));
        this.pet.hunger = Math.min(100, this.pet.hunger + (hours * 8 / rate));
        this.pet.energy = Math.max(0, this.pet.energy - (hours * 6 / rate));
        
        // Health decreases if hunger is high
        if (this.pet.hunger > 80) {
            this.pet.health = Math.max(0, this.pet.health - (hours * 3));
        }
    }

    async createPet(name, description) {
        try {
            // Generate pet image using AI
            const imageResult = await websim.imageGen({
                prompt: `Cute cartoon pet creature: ${description}. Friendly, colorful, fantasy style, suitable for a virtual pet game`,
                aspect_ratio: "1:1"
            });

            this.pet = {
                name,
                description,
                image: imageResult.url,
                happiness: 100,
                hunger: 20,
                health: 100,
                energy: 100,
                level: 1,
                experience: 0
            };

            // Save to records for lobby sharing
            await room.collection('pet').create({
                name,
                description,
                image: imageResult.url,
                stats: this.pet
            });

            this.saveToStorage();
            return true;
        } catch (error) {
            console.error('Error creating pet:', error);
            return false;
        }
    }

    feedPet() {
        if (this.money >= 10 && this.pet) {
            this.money -= 10;
            this.pet.hunger = Math.max(0, this.pet.hunger - 30);
            this.pet.happiness = Math.min(100, this.pet.happiness + 10);
            this.saveToStorage();
        }
    }

    playWithPet() {
        if (this.pet && this.pet.energy >= 20) {
            this.pet.energy -= 20;
            this.pet.happiness = Math.min(100, this.pet.happiness + 25);
            this.pet.experience += 5;
            this.checkLevelUp();
            this.saveToStorage();
        }
    }

    healPet() {
        if (this.money >= 25 && this.pet) {
            this.money -= 25;
            this.pet.health = 100;
            this.pet.happiness = Math.min(100, this.pet.happiness + 5);
            this.saveToStorage();
        }
    }

    checkLevelUp() {
        const expNeeded = this.pet.level * 100;
        if (this.pet.experience >= expNeeded) {
            this.pet.level++;
            this.pet.experience -= expNeeded;
            this.pet.happiness = Math.min(100, this.pet.happiness + 20);
        }
    }

    applyTipBonus(amount) {
        const bonus = amount / 100;
        this.tipMultiplier = Math.min(5.0, this.tipMultiplier + bonus);
        
        // Add status effect
        this.statusEffects.push({
            type: 'tip_bonus',
            name: 'Tip Blessing',
            duration: 24 * 60 * 60 * 1000, // 24 hours
            startTime: Date.now(),
            multiplier: bonus
        });

        this.saveToStorage();
    }

    updateStatusEffects() {
        const now = Date.now();
        this.statusEffects = this.statusEffects.filter(effect => {
            return (now - effect.startTime) < effect.duration;
        });

        // Recalculate multiplier
        this.tipMultiplier = 1.0;
        this.statusEffects.forEach(effect => {
            if (effect.type === 'tip_bonus') {
                this.tipMultiplier += effect.multiplier;
            }
        });
    }
}

// Minigame implementation
class ColorMatchGame {
    constructor() {
        this.score = 0;
        this.timeLeft = 30;
        this.currentColor = '';
        this.gameActive = false;
        this.colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8'];
    }

    start() {
        this.score = 0;
        this.timeLeft = 30;
        this.gameActive = true;
        this.generateNewColor();
        this.timer = setInterval(() => {
            this.timeLeft--;
            if (this.timeLeft <= 0) {
                this.end();
            }
            this.updateDisplay();
        }, 1000);
    }

    generateNewColor() {
        this.currentColor = this.colors[Math.floor(Math.random() * this.colors.length)];
        this.updateDisplay();
    }

    guess(color) {
        if (!this.gameActive) return;
        
        if (color === this.currentColor) {
            this.score += 10;
            this.generateNewColor();
        } else {
            this.score = Math.max(0, this.score - 5);
        }
        this.updateDisplay();
    }

    end() {
        this.gameActive = false;
        clearInterval(this.timer);
        
        // Calculate reward based on score and tip multiplier
        const baseReward = Math.floor(this.score / 2);
        const reward = Math.floor(baseReward * gameState.tipMultiplier);
        gameState.money += reward;
        gameState.saveToStorage();
        
        alert(`Game Over! Score: ${this.score}\nReward: ${reward} coins (${gameState.tipMultiplier.toFixed(1)}x multiplier)`);
    }

    updateDisplay() {
        const colorDisplay = document.getElementById('color-display');
        const scoreElement = document.getElementById('game-score');
        const timerElement = document.getElementById('game-timer');
        
        if (colorDisplay) colorDisplay.style.backgroundColor = this.currentColor;
        if (scoreElement) scoreElement.textContent = `Score: ${this.score}`;
        if (timerElement) timerElement.textContent = `Time: ${this.timeLeft}`;
    }
}

// Global game state
const gameState = new GameState();
const colorGame = new ColorMatchGame();

// Main App Component
function App() {
    const [, forceUpdate] = useState({});
    const [comments, setComments] = useState([]);
    const [lobbyPets, setLobbyPets] = useState([]);
    
    // Force re-render function
    const refresh = () => forceUpdate({});

    useEffect(() => {
        // Initialize game
        gameState.loadFromStorage();
        
        // Update game state every 30 seconds
        const gameInterval = setInterval(() => {
            if (gameState.pet) {
                gameState.applyOfflineProgression(30000); // 30 seconds
                gameState.updateStatusEffects();
                gameState.saveToStorage();
                refresh();
            }
        }, 30000);

        // Load comments
        loadComments();
        
        // Listen for new comments with tips
        window.websim.addEventListener('comment:created', (data) => {
            const comment = data.comment;
            if (comment.card_data && comment.card_data.type === 'tip_comment') {
                gameState.applyTipBonus(comment.card_data.credits_spent);
                refresh();
            }
            loadComments();
        });

        // Subscribe to lobby pets
        room.collection('pet').subscribe((pets) => {
            setLobbyPets(pets.slice(0, 10)); // Show top 10 recent pets
        });

        return () => clearInterval(gameInterval);
    }, []);

    const loadComments = async () => {
        try {
            const project = await window.websim.getCurrentProject();
            const response = await fetch(`/api/v1/projects/${project.id}/comments?only_tips=true&first=5`);
            const data = await response.json();
            setComments(data.comments.data);
        } catch (error) {
            console.error('Error loading comments:', error);
        }
    };

    const showPetCreation = () => {
        document.getElementById('pet-creation-modal').classList.remove('hidden');
    };

    const showMinigame = () => {
        document.getElementById('minigame-modal').classList.remove('hidden');
        setupMinigame();
    };

    if (!gameState.pet) {
        return (
            <div id="app">
                <div className="header">
                    <div className="logo">NeoPets Idle</div>
                </div>
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flex: 1,
                    flexDirection: 'column',
                    gap: '2rem'
                }}>
                    <h1>Welcome to NeoPets Idle!</h1>
                    <p>Create your first pet to begin your journey</p>
                    <button className="btn btn-primary" onClick={showPetCreation}>
                        Create Your Pet
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div id="app">
            <div className="header">
                <div className="logo">NeoPets Idle</div>
                <div className="user-stats">
                    <div className="stat-item">
                        <span>💰</span>
                        <span>{gameState.money} coins</span>
                    </div>
                    <div className="stat-item">
                        <span>⭐</span>
                        <span>{gameState.tipMultiplier.toFixed(1)}x multiplier</span>
                    </div>
                </div>
            </div>

            <div className="main-content">
                <div className="pet-area">
                    <div className="pet-display">
                        <img 
                            src={gameState.pet.image} 
                            alt={gameState.pet.name}
                            className="pet-image"
                        />
                        <h2 className="pet-name">{gameState.pet.name}</h2>
                        <p>Level {gameState.pet.level}</p>
                        
                        {gameState.statusEffects.length > 0 && (
                            <div className="status-effects">
                                {gameState.statusEffects.map((effect, index) => (
                                    <div key={index} className="status-effect positive">
                                        {effect.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="pet-stats">
                        <div className="stat-bar happiness">
                            <h3>😊 Happiness</h3>
                            <div className="progress-bar">
                                <div 
                                    className="progress-fill"
                                    style={{width: `${gameState.pet.happiness}%`}}
                                ></div>
                            </div>
                        </div>
                        
                        <div className="stat-bar hunger">
                            <h3>🍕 Hunger</h3>
                            <div className="progress-bar">
                                <div 
                                    className="progress-fill"
                                    style={{width: `${gameState.pet.hunger}%`}}
                                ></div>
                            </div>
                        </div>
                        
                        <div className="stat-bar health">
                            <h3>❤️ Health</h3>
                            <div className="progress-bar">
                                <div 
                                    className="progress-fill"
                                    style={{width: `${gameState.pet.health}%`}}
                                ></div>
                            </div>
                        </div>
                        
                        <div className="stat-bar energy">
                            <h3>⚡ Energy</h3>
                            <div className="progress-bar">
                                <div 
                                    className="progress-fill"
                                    style={{width: `${gameState.pet.energy}%`}}
                                ></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="sidebar">
                    <div className="panel">
                        <h2>Actions</h2>
                        <div className="action-buttons">
                            <button 
                                className="btn btn-primary"
                                onClick={() => gameState.feedPet() || refresh()}
                                disabled={gameState.money < 10}
                            >
                                🍎 Feed Pet (10 coins)
                            </button>
                            <button 
                                className="btn btn-primary"
                                onClick={() => gameState.playWithPet() || refresh()}
                                disabled={gameState.pet.energy < 20}
                            >
                                🎾 Play (20 energy)
                            </button>
                            <button 
                                className="btn btn-primary"
                                onClick={() => gameState.healPet() || refresh()}
                                disabled={gameState.money < 25}
                            >
                                💊 Heal Pet (25 coins)
                            </button>
                            <button 
                                className="btn btn-secondary"
                                onClick={showMinigame}
                            >
                                🎮 Play Minigame
                            </button>
                        </div>
                    </div>

                    <div className="panel">
                        <h2>🏆 Tip Benefits</h2>
                        {gameState.tipMultiplier > 1.0 ? (
                            <div className="tip-benefits">
                                <div className="tip-multiplier">
                                    {gameState.tipMultiplier.toFixed(1)}x Active!
                                </div>
                                <p>• Slower stat decay</p>
                                <p>• Higher minigame rewards</p>
                                <p>• Better offline progression</p>
                            </div>
                        ) : (
                            <div>
                                <p>Tip on this project to boost your pet's abilities!</p>
                                <button 
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        await window.websim.postComment({
                                            content: "Supporting this amazing pet game! 🎮"
                                        });
                                    }}
                                    style={{marginTop: '1rem'}}
                                >
                                    💝 Leave a Tip Comment
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="panel">
                        <h2>🌟 Recent Tips</h2>
                        <div className="comments-section">
                            {comments.length === 0 ? (
                                <p>No tips yet! Be the first to support this project.</p>
                            ) : (
                                comments.map((commentData, index) => (
                                    <div key={index} className="comment">
                                        <div className="comment-author">
                                            {commentData.comment.author.display_name}
                                        </div>
                                        <div className="comment-content">
                                            {commentData.comment.raw_content}
                                        </div>
                                        {commentData.comment.card_data && (
                                            <div className="comment-tip">
                                                💎 {commentData.comment.card_data.credits_spent} credits
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="panel">
                        <h2>🏠 Pet Lobby</h2>
                        <div className="lobby-pets">
                            {lobbyPets.map((petData, index) => (
                                <div key={petData.id} className="lobby-pet">
                                    <img 
                                        src={petData.image} 
                                        alt={petData.name}
                                        className="lobby-pet-avatar"
                                    />
                                    <div className="lobby-pet-info">
                                        <div className="lobby-pet-name">{petData.name}</div>
                                        <div className="lobby-pet-owner">by {petData.username}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Pet Creation Modal Logic
function setupPetCreation() {
    const modal = document.getElementById('pet-creation-modal');
    const generateBtn = document.getElementById('generate-pet');
    const confirmBtn = document.getElementById('confirm-pet');
    const nameInput = document.getElementById('pet-name');
    const descInput = document.getElementById('pet-description');
    const preview = document.getElementById('pet-preview');

    generateBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const description = descInput.value.trim();
        
        if (!name || !description) {
            alert('Please enter both a name and description for your pet!');
            return;
        }

        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';

        try {
            const imageResult = await websim.imageGen({
                prompt: `Cute cartoon pet creature: ${description}. Friendly, colorful, fantasy style, suitable for a virtual pet game`,
                aspect_ratio: "1:1"
            });

            preview.innerHTML = `<img src="${imageResult.url}" alt="${name}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover;">`;
            confirmBtn.classList.remove('hidden');
            confirmBtn.onclick = async () => {
                const success = await gameState.createPet(name, description);
                if (success) {
                    modal.classList.add('hidden');
                    location.reload(); // Refresh to show the pet
                }
            };
        } catch (error) {
            alert('Error generating pet. Please try again!');
        }

        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Pet';
    });

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
}

// Minigame Modal Logic
function setupMinigame() {
    const modal = document.getElementById('minigame-modal');
    const closeBtn = document.getElementById('close-minigame');
    const optionsContainer = document.getElementById('color-options');
    
    // Create color options
    optionsContainer.innerHTML = '';
    colorGame.colors.forEach(color => {
        const option = document.createElement('div');
        option.className = 'color-option';
        option.style.backgroundColor = color;
        option.addEventListener('click', () => colorGame.guess(color));
        optionsContainer.appendChild(option);
    });

    // Start the game
    colorGame.start();

    closeBtn.addEventListener('click', () => {
        colorGame.end();
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            colorGame.end();
            modal.classList.add('hidden');
        }
    });
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    setupPetCreation();
    ReactDOM.render(<App />, document.getElementById('app'));
});

