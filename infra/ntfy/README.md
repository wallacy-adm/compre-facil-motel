# ntfy.sh Self-Hosted — Deploy Guide

Servidor de notificações push para iOS do CompraFácil Motel.

## Pré-requisitos

- Conta no Fly.io (gratuita, requer cartão para verificação)
- `fly` CLI instalado: `curl -L https://fly.io/install.sh | sh`

## Deploy inicial (feito apenas uma vez)

### 1. Login e launch

```bash
fly auth login
cd infra/ntfy
fly launch --name ntfy-comprafacil --no-deploy
```

### 2. Criar volumes

```bash
fly volumes create ntfy_data --size 1 --region gru
fly volumes create ntfy_config --size 1 --region gru
```

### 3. Deploy inicial

```bash
fly deploy
```

### 4. Subir o server.yml para o volume de config

```bash
fly ssh console
# Dentro do container, criar/editar /etc/ntfy/server.yml
# Cole o conteúdo do arquivo server.yml deste repositório
exit
```

### 5. Criar usuário admin

```bash
fly ssh console
ntfy user add --role=admin admin
# Digite uma senha forte e anote: NTFY_ADMIN_PASSWORD
exit
```

### 6. Obter token do admin para a Edge Function send-push

```bash
fly ssh console
# Gera token para o usuário admin (publisher)
ntfy token add --user admin "comprafacil-publisher"
# Anote o token gerado: NTFY_PUBLISHER_TOKEN
exit
```

### 7. Configurar Secrets no Supabase

No Supabase Dashboard → Project Settings → Edge Functions → Secrets:

| Secret | Valor |
|--------|-------|
| `NTFY_BASE_URL` | `https://ntfy-comprafacil.fly.dev` |
| `NTFY_PUBLISHER_TOKEN` | `tk_XXXXX` (token do passo 6) |
| `NTFY_ADMIN_BASIC_AUTH` | `Basic base64(admin:SENHA)` — ver abaixo |

Para gerar `NTFY_ADMIN_BASIC_AUTH`:
```bash
echo -n "admin:SUA_SENHA" | base64
# Resultado: YWRtaW46U1VBX1NFTkhB
# Valor do secret: Basic YWRtaW46U1VBX1NFTkhB
```

### 8. (Recomendado) Criar conta no ntfy.sh cloud para relay iOS ilimitado

1. Acessar https://ntfy.sh e criar conta gratuita
2. Gerar access token em Settings → Access Tokens
3. Editar `server.yml` e descomentar: `upstream-access-token: "tk_XXXXX"`
4. Redeploy: `fly deploy`

## Verificação de saúde

```bash
curl https://ntfy-comprafacil.fly.dev/v1/health
# Esperado: {"healthy":true}
```

## Verificar endpoint de tokens (obrigatório antes de implementar generate-ntfy-token)

```bash
curl -v -u admin:SUA_SENHA https://ntfy-comprafacil.fly.dev/v1/account/token
# Esperado: 200 OK com lista de tokens
# Se 404: usar abordagem CLI (ntfy token add) em vez da API HTTP
```

## Testar envio manual

```bash
# Substituir com valores reais
curl -H "Authorization: Bearer SEU_PUBLISHER_TOKEN" \
     -H "Title: Teste" \
     -H "Priority: high" \
     -d "Notificação de teste" \
     https://ntfy-comprafacil.fly.dev/pedidos-teste
```

## Redeploy após mudanças no server.yml

```bash
fly deploy
```

## Limites do relay iOS (ntfy.sh cloud)

- Plano gratuito: 250 pokes/dia (cada poke é apenas o ID da mensagem, ~50 bytes)
- Para equipe de 2-10 com até 40 pedidos/dia: ~200 pokes/dia (próximo do limite)
- **Recomendado:** criar conta em ntfy.sh cloud e configurar `upstream-access-token` para aumentar limite

## Risco e contingência

Se o Fly.io mudar os termos do plano gratuito:
- O servidor ntfy é stateless (mensagens expiram em 12h)
- Migrar para Railway.app ou Render.com: mesma imagem Docker, sem perda de dados permanentes
- O Canal 1 (Web Push) continua funcionando independentemente
