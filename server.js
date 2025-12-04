const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Arquivos
const DADOS_FILE = path.join(__dirname, 'dados.txt');
const ESTADO_FILE = path.join(__dirname, 'estado.txt');

// Estado atual do sistema
let estadoAtual = {
    temperatura: 0,
    pressao: 0,
    valvula1: false,
    valvula2: false,
    ultimaAtualizacao: null
};

// Comando pendente para o Nó 5 buscar
let comandoPendente = {
    emissao_ativa: false  // Começa DESLIGADO (sincronizado com Nó 1)
};

// Garante que os arquivos existem
if (!fs.existsSync(DADOS_FILE)) {
    fs.writeFileSync(DADOS_FILE, '');
}

// Carrega estado salvo (se existir)
if (fs.existsSync(ESTADO_FILE)) {
    try {
        const estadoSalvo = JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8'));
        comandoPendente.emissao_ativa = estadoSalvo.emissao_ativa || false;
        console.log(`[INIT] Estado carregado: emissao_ativa = ${comandoPendente.emissao_ativa}`);
    } catch (e) {
        console.log('[INIT] Arquivo de estado inválido, usando padrão (false)');
        fs.writeFileSync(ESTADO_FILE, JSON.stringify({ emissao_ativa: false }));
    }
} else {
    fs.writeFileSync(ESTADO_FILE, JSON.stringify({ emissao_ativa: false }));
    console.log('[INIT] Arquivo de estado criado: emissao_ativa = false');
}

// Função para salvar estado
function salvarEstado() {
    fs.writeFileSync(ESTADO_FILE, JSON.stringify({ emissao_ativa: comandoPendente.emissao_ativa }));
}

// =============================================================================
// ROTAS DA API
// =============================================================================

/**
 * POST /api/dados
 * Recebe dados do Nó 5 (temperatura, pressão, estado das válvulas)
 */
app.post('/api/dados', (req, res) => {
    const { temperatura, pressao, valvula1, valvula2 } = req.body;
    
    // Atualiza estado atual
    estadoAtual = {
        temperatura: temperatura ?? estadoAtual.temperatura,
        pressao: pressao ?? estadoAtual.pressao,
        valvula1: valvula1 ?? estadoAtual.valvula1,
        valvula2: valvula2 ?? estadoAtual.valvula2,
        ultimaAtualizacao: new Date().toISOString()
    };
    
    // Salva no arquivo
    const linha = JSON.stringify({
        timestamp: estadoAtual.ultimaAtualizacao,
        temperatura: estadoAtual.temperatura,
        pressao: estadoAtual.pressao,
        valvula1: estadoAtual.valvula1,
        valvula2: estadoAtual.valvula2
    }) + '\n';
    
    fs.appendFileSync(DADOS_FILE, linha);
    
    console.log(`[POST /api/dados] T: ${temperatura}°C | P: ${pressao} bar | V1: ${valvula1} | V2: ${valvula2}`);
    
    res.json({ success: true, message: 'Dados recebidos' });
});

/**
 * GET /api/comando
 * Nó 5 consulta se há comando pendente
 */
app.get('/api/comando', (req, res) => {
    console.log(`[GET /api/comando] Retornando: emissao_ativa = ${comandoPendente.emissao_ativa}`);
    res.json(comandoPendente);
});

/**
 * POST /api/comando
 * Frontend envia comando para alterar estado das válvulas
 */
app.post('/api/comando', (req, res) => {
    const { emissao_ativa, valvula1, valvula2 } = req.body;
    
    // Se receber emissao_ativa, controla ambas as válvulas
    if (typeof emissao_ativa === 'boolean') {
        comandoPendente.emissao_ativa = emissao_ativa;
        salvarEstado();  // Persiste no arquivo
        console.log(`[POST /api/comando] Emissão alterada para: ${emissao_ativa} (salvo em estado.txt)`);
    }
    
    // Controle individual (opcional, para expansão futura)
    if (typeof valvula1 === 'boolean') {
        comandoPendente.valvula1 = valvula1;
    }
    if (typeof valvula2 === 'boolean') {
        comandoPendente.valvula2 = valvula2;
    }
    
    res.json({ success: true, comando: comandoPendente });
});

/**
 * GET /api/estado
 * Frontend busca estado atual dos sensores
 */
app.get('/api/estado', (req, res) => {
    res.json({
        ...estadoAtual,
        comandoAtual: comandoPendente
    });
});

/**
 * GET /api/historico
 * Retorna últimas N leituras do arquivo
 */
app.get('/api/historico', (req, res) => {
    const limite = parseInt(req.query.limite) || 20;
    
    try {
        const conteudo = fs.readFileSync(DADOS_FILE, 'utf8');
        const linhas = conteudo.trim().split('\n').filter(l => l);
        const ultimas = linhas.slice(-limite);
        
        const historico = ultimas.map(linha => {
            try {
                return JSON.parse(linha);
            } catch {
                return null;
            }
        }).filter(item => item !== null);
        
        res.json(historico);
    } catch (error) {
        res.json([]);
    }
});

/**
 * DELETE /api/historico
 * Limpa o arquivo de histórico
 */
app.delete('/api/historico', (req, res) => {
    fs.writeFileSync(DADOS_FILE, '');
    console.log('[DELETE /api/historico] Histórico limpo');
    res.json({ success: true, message: 'Histórico limpo' });
});

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║         SERVIDOR DE CONTROLE - REDE CAN                   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Servidor rodando em: http://localhost:${PORT}`);
    console.log(`  Interface web:       http://localhost:${PORT}/index.html`);
    console.log('');
    console.log('  Rotas disponíveis:');
    console.log('    POST /api/dados     - Recebe dados do Nó 5');
    console.log('    GET  /api/comando   - Nó 5 busca comandos');
    console.log('    POST /api/comando   - Frontend envia comandos');
    console.log('    GET  /api/estado    - Frontend busca estado atual');
    console.log('    GET  /api/historico - Retorna histórico de leituras');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
});