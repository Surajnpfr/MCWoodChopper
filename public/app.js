document.addEventListener('DOMContentLoaded', () => {
    const launchForm = document.getElementById('launch-form');
    const stopAllBtn = document.getElementById('stop-all-btn');
    const botsGrid = document.getElementById('bots-grid');
    const template = document.getElementById('bot-card-template');
    const activeCountSpan = document.getElementById('active-count');

    // Fetch initial config to populate defaults
    fetch('/api/config')
        .then(res => res.json())
        .then(config => {
            const ipInput = document.getElementById('serverIp');
            const nameInput = document.getElementById('baseName');
            if(!ipInput.value) {
                ipInput.value = `${config.server.host}:${config.server.port}`;
            }
            if(!nameInput.value) {
                nameInput.value = config.bot.username || 'WoodBot';
            }
        });

    // Launch form submit
    launchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const serverIp = document.getElementById('serverIp').value;
        const baseName = document.getElementById('baseName').value;
        const count = parseInt(document.getElementById('botCount').value);
        const serverPassword = document.getElementById('serverPassword').value;
        
        const btn = document.getElementById('launch-btn');
        const originalText = btn.innerText;
        btn.innerText = 'Deploying...';
        btn.disabled = true;

        try {
            const res = await fetch('/api/bots/launch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverIp, baseName, count, serverPassword })
            });
            const data = await res.json();
            if(data.success) {
                refreshBots();
            }
        } catch (err) {
            console.error('Failed to launch bots', err);
            alert('Error launching bots. Check console.');
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });

    // Stop all button
    stopAllBtn.addEventListener('click', async () => {
        if(!confirm('Are you sure you want to stop all bots?')) return;
        try {
            await fetch('/api/bots/stop-all', { method: 'POST' });
            refreshBots();
        } catch (err) {
            console.error(err);
        }
    });

    // Stop single bot
    async function stopBot(id) {
        try {
            await fetch(`/api/bots/stop/${id}`, { method: 'POST' });
            refreshBots();
        } catch (err) {
            console.error(err);
        }
    }

    // Polling mechanism
    async function refreshBots() {
        try {
            const res = await fetch('/api/bots');
            const bots = await res.json();
            renderBots(bots);
        } catch (err) {
            console.error('Failed to fetch bots', err);
        }
    }

    function renderBots(bots) {
        activeCountSpan.innerText = bots.length;
        botsGrid.innerHTML = ''; // Clear grid
        
        bots.forEach(bot => {
            const clone = template.content.cloneNode(true);
            
            // Set data
            clone.querySelector('.bot-name').innerText = bot.username;
            
            const indicator = clone.querySelector('.status-indicator');
            if (bot.online) indicator.classList.add('online');
            
            clone.querySelector('.bot-state').innerText = bot.state;
            // Color state by category
            const stateEl = clone.querySelector('.bot-state');
            const activeStates = ['chopping', 'collecting', 'planting', 'depositing', 'setting_spawn'];
            const idleStates = ['waiting', 'scanning', 'idle'];
            const warnStates = ['teleported', 'reconnecting', 'dead', 'kicked'];
            if (activeStates.includes(bot.state)) {
                stateEl.style.color = 'var(--accent-green)';
            } else if (warnStates.includes(bot.state)) {
                stateEl.style.color = 'var(--danger)';
            } else if (idleStates.includes(bot.state)) {
                stateEl.style.color = 'var(--accent-yellow)';
            }
            
            // Health is out of 20
            const healthPct = (bot.health / 20) * 100;
            const healthBar = clone.querySelector('.bot-health');
            healthBar.style.width = `${Math.max(0, healthPct)}%`;
            if (healthPct > 50) healthBar.style.background = 'var(--accent-green)';
            
            // Food is out of 20
            const foodPct = (bot.food / 20) * 100;
            clone.querySelector('.bot-food').style.width = `${Math.max(0, foodPct)}%`;
            
            // Inventory
            clone.querySelector('.bot-inv').style.width = `${bot.inventoryFullness}%`;
            
            // Stats
            clone.querySelector('.bot-logs').innerText = bot.stats.logsCollected;
            clone.querySelector('.bot-trees').innerText = bot.stats.treesChopped;
            // Axe presence
            clone.querySelector('.bot-axe').innerText = bot.hasAxe ? '✅' : '❌';
            
            // Stop button
            const stopBtn = clone.querySelector('.stop-bot-btn');
            stopBtn.addEventListener('click', () => stopBot(bot.id));
            
            botsGrid.appendChild(clone);
        });
    }

    // Start polling
    setInterval(refreshBots, 1000);
    refreshBots();
});
