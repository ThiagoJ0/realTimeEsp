const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static('public'));

const DADOS_FILE = path.join(__dirname, 'dados.txt');
const ESTADO_FILE = path.join(__dirname, 'estado.txt');

// Estado atual (leituras dos sensores)
let estadoAtual = {
    temperatura: 0,
    pressao: 0,
    ultimaAtualizacao: null
};

// Comando pendente (INDIVIDUAL)
let comandoPendente = {
    valvula1: false,
    valvula2: false
};

// Garante que os arquivos existem
if (!fs.existsSync(DADOS_FILE)) {
    fs.writeFileSync(DADOS_FILE, '');
}

// Carrega estado salvo
if (fs.existsSync(ESTADO_FILE)) {
    try {
        const estadoSalvo = JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8'));
        comandoPendente.valvula1 = estadoSalvo.valvula1 || false;
        comandoPendente.valvula2 = estadoSalvo.valvula2 || false;
        console.log(`[INIT] V1=${comandoPendente.valvula1}, V2=${comandoPendente.valvula2}`);
    } catch (e) {
        fs.writeFileSync(ESTADO_FILE, JSON.stringify({ valvula1: false, valvula2: false }));
    }
} else {
    fs.writeFileSync(ESTADO_FILE, JSON.stringify({ valvula1: false, valvula2: false }));
}

function salvarEstado() {
    fs.writeFileSync(ESTADO_FILE, JSON.stringify({
        valvula1: comandoPendente.valvula1,
        valvula2: comandoPendente.valvula2
    }));
}

// =============================================================================
// ROTAS
// =============================================================================

// Recebe dados do Nó 5 (só temperatura e pressão)
app.post('/api/dados', (req, res) => {
    const { temperatura, pressao } = req.body;
    
    estadoAtual = {
        temperatura: temperatura ?? estadoAtual.temperatura,
        pressao: pressao ?? estadoAtual.pressao,
        ultimaAtualizacao: new Date().toISOString()
    };
    
    // Salva no histórico com válvulas do comando
    const linha = JSON.stringify({
        timestamp: estadoAtual.ultimaAtualizacao,
        temperatura: estadoAtual.temperatura,
        pressao: estadoAtual.pressao,
        valvula1: comandoPendente.valvula1,
        valvula2: comandoPendente.valvula2
    }) + '\n';
    
    fs.appendFileSync(DADOS_FILE, linha);
    console.log(`[DADOS] T:${temperatura} P:${pressao}`);
    
    res.json({ success: true });
});

// Nó 5 busca comandos
app.get('/api/comando', (req, res) => {
    const resposta = {
        valvula1: comandoPendente.valvula1,
        valvula2: comandoPendente.valvula2
    };
    console.log(`[GET CMD] V1=${resposta.valvula1} V2=${resposta.valvula2}`);
    res.json(resposta);
});

// Frontend envia comandos
app.post('/api/comando', (req, res) => {
    const { emissao_ativa, valvula1, valvula2 } = req.body;
    
    if (typeof emissao_ativa === 'boolean') {
        comandoPendente.valvula1 = emissao_ativa;
        comandoPendente.valvula2 = emissao_ativa;
        salvarEstado();
        console.log(`[CMD] TODAS: ${emissao_ativa}`);
    }
    
    if (typeof valvula1 === 'boolean') {
        comandoPendente.valvula1 = valvula1;
        salvarEstado();
        console.log(`[CMD] V1: ${valvula1}`);
    }
    
    if (typeof valvula2 === 'boolean') {
        comandoPendente.valvula2 = valvula2;
        salvarEstado();
        console.log(`[CMD] V2: ${valvula2}`);
    }
    
    res.json({ success: true, comando: comandoPendente });
});

// Frontend busca estado (válvulas vêm do comando)
app.get('/api/estado', (req, res) => {
    res.json({
        temperatura: estadoAtual.temperatura,
        pressao: estadoAtual.pressao,
        valvula1: comandoPendente.valvula1,
        valvula2: comandoPendente.valvula2,
        ultimaAtualizacao: estadoAtual.ultimaAtualizacao,
        comandoAtual: {
            valvula1: comandoPendente.valvula1,
            valvula2: comandoPendente.valvula2
        }
    });
});

// Histórico
app.get('/api/historico', (req, res) => {
    const limite = parseInt(req.query.limite) || 20;
    
    try {
        const conteudo = fs.readFileSync(DADOS_FILE, 'utf8');
        const linhas = conteudo.trim().split('\n').filter(l => l);
        const ultimas = linhas.slice(-limite);
        
        const historico = ultimas.map(linha => {
            try { return JSON.parse(linha); } 
            catch { return null; }
        }).filter(item => item !== null);
        
        res.json(historico);
    } catch (error) {
        res.json([]);
    }
});

app.delete('/api/historico', (req, res) => {
    fs.writeFileSync(DADOS_FILE, '');
    res.json({ success: true });
});

// =============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=== SERVIDOR CAN - http://localhost:${PORT} ===\n`);
});