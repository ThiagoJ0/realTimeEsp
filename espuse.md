# Integração ESP32 (Nó 5) com o Servidor

## Configuração no ESP32

```c
#define SERVER_IP    "192.168.x.x"  // IP do computador rodando o servidor
#define SERVER_PORT  5000            // Porta do servidor
```

---

## 1. ENVIAR DADOS DOS SENSORES

O Nó 5 envia os dados recebidos do Nó 1 via CAN para o servidor.

### Endpoint
```
POST http://<SERVER_IP>:5000/api/dados
Content-Type: application/json
```

### Payload JSON
```json
{
    "temperatura": 28.50,
    "pressao": 3.20,
    "valvula1": true,
    "valvula2": true
}
```

### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| temperatura | float | Temperatura em °C (ex: 28.50) |
| pressao | float | Pressão em bar (ex: 3.20) |
| valvula1 | boolean | Estado da válvula 1 (true = aberta) |
| valvula2 | boolean | Estado da válvula 2 (true = aberta) |

### Resposta do Servidor
```json
{
    "success": true,
    "message": "Dados recebidos"
}
```

### Código ESP32 (já implementado no seu Nó 5)
```c
static void http_enviar_dados(void)
{
    // JSON
    char json[128];
    snprintf(json, sizeof(json),
        "{\"temperatura\":%.2f,\"pressao\":%.2f,\"valvula1\":%s,\"valvula2\":%s}",
        temp, press, v1 ? "true" : "false", v2 ? "true" : "false");
    
    char url[64];
    snprintf(url, sizeof(url), "http://%s:%d/api/dados", SERVER_IP, SERVER_PORT);
    
    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 10000,
    };
    
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, json, strlen(json));
    
    esp_err_t err = esp_http_client_perform(client);
    esp_http_client_cleanup(client);
}
```

### Teste com cURL
```bash
curl -X POST http://localhost:5000/api/dados \
  -H "Content-Type: application/json" \
  -d '{"temperatura":28.50,"pressao":3.20,"valvula1":true,"valvula2":true}'
```

---

## 2. BUSCAR COMANDOS (POLLING)

O Nó 5 consulta periodicamente se há comandos pendentes do frontend.

### Endpoint
```
GET http://<SERVER_IP>:5000/api/comando
```

### Resposta do Servidor
```json
{
    "emissao_ativa": true
}
```

### Campos da Resposta

| Campo | Tipo | Descrição |
|-------|------|-----------|
| emissao_ativa | boolean | true = válvulas abertas, false = válvulas fechadas |

### Lógica no ESP32

```c
static void http_buscar_comando(void)
{
    // Faz GET em /api/comando
    char url[64];
    snprintf(url, sizeof(url), "http://%s:%d/api/comando", SERVER_IP, SERVER_PORT);
    
    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 10000,
        .event_handler = http_event_handler,  // Captura resposta
    };
    
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_err_t err = esp_http_client_perform(client);
    
    if (err == ESP_OK && esp_http_client_get_status_code(client) == 200) {
        // Analisa resposta (http_response contém o JSON)
        bool novo_estado = emissao_ativa;
        
        if (strstr(http_response, "\"emissao_ativa\":true")) {
            novo_estado = true;
        } else if (strstr(http_response, "\"emissao_ativa\":false")) {
            novo_estado = false;
        }
        
        // Se mudou, envia para o Nó 1 via CAN
        if (novo_estado != emissao_ativa) {
            emissao_ativa = novo_estado;
            
            twai_message_t msg = {
                .identifier = CAN_ID_CMD_VALVULAS,  // 0x501
                .data_length_code = 2,
                .data = {emissao_ativa ? 1 : 0, emissao_ativa ? 1 : 0}
            };
            twai_transmit(&msg, pdMS_TO_TICKS(100));
        }
    }
    
    esp_http_client_cleanup(client);
}
```

### Teste com cURL
```bash
curl http://localhost:5000/api/comando
```

Resposta:
```json
{"emissao_ativa":true}
```

---

## 3. FLUXO COMPLETO

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FLUXO DE DADOS                              │
└─────────────────────────────────────────────────────────────────────┘

  SENSORES → SERVIDOR:
  
    Nó 1              Nó 5                 Servidor            Frontend
      │                 │                     │                   │
      │──── CAN ───────>│                     │                   │
      │  (0x101,102,103)│                     │                   │
      │                 │─── POST /api/dados ─>│                   │
      │                 │    {temp, pressao,  │                   │
      │                 │     v1, v2}         │                   │
      │                 │                     │<── GET /api/estado─│
      │                 │                     │────── {dados} ────>│
      │                 │                     │                   │


  COMANDOS → NÓ 1:
  
    Frontend           Servidor              Nó 5               Nó 1
      │                   │                    │                  │
      │─ POST /api/comando─>│                  │                  │
      │  {emissao_ativa}  │                    │                  │
      │                   │<─ GET /api/comando─│                  │
      │                   │─── {emissao_ativa}─>│                  │
      │                   │                    │──── CAN 0x501 ──>│
      │                   │                    │   [v1, v2]       │
      │                   │                    │                  │
```

---

## 4. INTERVALOS RECOMENDADOS

| Ação | Intervalo | Motivo |
|------|-----------|--------|
| Enviar dados (POST) | 5000 ms | Não sobrecarregar servidor |
| Buscar comandos (GET) | 3000 ms | Resposta rápida a comandos |

```c
#define INTERVALO_ENVIO_MS      5000
#define INTERVALO_COMANDO_MS    3000
```

---

## 5. TRATAMENTO DE ERROS

### ESP32 deve tratar:

```c
esp_err_t err = esp_http_client_perform(client);

if (err == ESP_OK) {
    int status = esp_http_client_get_status_code(client);
    if (status == 200) {
        // Sucesso
    } else {
        ESP_LOGW(TAG, "Servidor retornou status %d", status);
    }
} else {
    ESP_LOGE(TAG, "Erro HTTP: %s", esp_err_to_name(err));
    // Possíveis erros:
    // ESP_ERR_HTTP_CONNECT - Servidor offline
    // ESP_ERR_HTTP_WRITE_DATA - Falha ao enviar
    // ESP_ERR_HTTP_FETCH_HEADER - Timeout
}
```

---

## 6. RESUMO RÁPIDO

### Enviar dados:
```
POST /api/dados
{"temperatura":25.0,"pressao":2.5,"valvula1":true,"valvula2":false}
```

### Ler comandos:
```
GET /api/comando
→ {"emissao_ativa":true}
```

### IDs CAN usados:

| ID | Direção | Descrição |
|----|---------|-----------|
| 0x101 | Nó1 → Nó5 | Temperatura (float) |
| 0x102 | Nó1 → Nó5 | Pressão (float) |
| 0x103 | Nó1 → Nó5 | Status válvulas (2 bytes) |
| 0x501 | Nó5 → Nó1 | Comando válvulas (2 bytes) |