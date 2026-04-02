# E2E Test Checklist — Ntfy Dual-Channel Notifications

> **Pré-requisitos antes de executar:**
> - Servidor ntfy no Fly.io deployado (ver `infra/ntfy/README.md`)
> - Secrets configurados no Supabase: `NTFY_BASE_URL`, `NTFY_PUBLISHER_TOKEN`, `NTFY_ADMIN_BASIC_AUTH`
> - Migration aplicada: `supabase/migrations/20260401200000_add_ntfy_token.sql`
> - Edge Functions deployadas: `generate-ntfy-token` e `send-push`
> - App buildado e acessível no iPhone via Add to Home Screen (PWA instalado)

---

## Fase 1: Infraestrutura

- [ ] **1.1 Saúde do servidor ntfy**
  ```bash
  curl https://ntfy-comprafacil.fly.dev/v1/health
  ```
  ✅ Esperado: `{"healthy":true}`

- [ ] **1.2 Colunas no banco de dados**

  Supabase Dashboard → Table Editor → users
  ✅ Esperado: colunas `ntfy_token` e `ntfy_topic` presentes com valor NULL para todos os usuários

- [ ] **1.3 Secrets configurados nas Edge Functions**

  Supabase Dashboard → Edge Functions → Configurações
  ✅ Esperado: `NTFY_BASE_URL`, `NTFY_PUBLISHER_TOKEN`, `NTFY_ADMIN_BASIC_AUTH` listados

---

## Fase 2: Edge Function generate-ntfy-token

- [ ] **2.1 Gerar token (POST)**

  No browser com o app aberto, DevTools → Console:
  ```javascript
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(location.origin + '/functions/v1/generate-ntfy-token', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}` }
  });
  console.log(await res.json());
  ```
  ✅ Esperado: `{ token: "tk_XXXXX", topic: "pedidos-XXXXXXXX", server_url: "https://ntfy-comprafacil.fly.dev" }`

- [ ] **2.2 Token persistido no banco**

  Supabase Dashboard → Table Editor → users: usuário testado
  ✅ Esperado: `ntfy_token` e `ntfy_topic` preenchidos

- [ ] **2.3 Idempotência (POST repetido retorna mesmo token)**

  Repetir o mesmo fetch do passo 2.1
  ✅ Esperado: mesmo `token` e `topic` retornados sem criar novo token

- [ ] **2.4 Revogar token (DELETE)**
  ```javascript
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(location.origin + '/functions/v1/generate-ntfy-token', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${session.access_token}` }
  });
  console.log(await res.json());
  ```
  ✅ Esperado: `{ revoked: true }`

  Verificar no banco: `ntfy_token` e `ntfy_topic` voltaram a NULL

---

## Fase 3: NtfySetupCard no PWA (iPhone)

- [ ] **3.1 Card aparece no app standalone**

  No iPhone com PWA instalado (Add to Home Screen):
  ✅ Esperado: card azul "📱 Notificações confiáveis no iPhone" visível com botão "Configurar agora"

  > Se o card não aparecer: verificar `isRunningStandalone()` retorna `true` no browser do iPhone

- [ ] **3.2 Fluxo de configuração completo**

  1. Tocar "Configurar agora" → card muda para amarelo com 2 passos
  2. Baixar app ntfy da App Store (se ainda não instalado)
  3. Tocar "🔗 Abrir ntfy configurado" → app ntfy abre já configurado com o servidor
  4. Verificar no app ntfy: servidor `ntfy-comprafacil.fly.dev` e tópico `pedidos-XXXXXXXX` configurados
  5. Tocar "✅ Já configurei — Testar notificação agora"
  ✅ Esperado: card muda para verde "✅ Notificações iOS ativas" + notificação chega em < 5 segundos

- [ ] **3.3 Deep link funciona corretamente**

  ✅ Esperado: app ntfy abre na tela de subscribe com servidor e tópico pré-preenchidos

  > Se o deep link não funcionar: tentar copiar o link manualmente e colar no campo de URL do app ntfy

- [ ] **3.4 Desativar notificações**

  No card verde "✅ Notificações iOS ativas", tocar "Desativar":
  ✅ Esperado:
  - Card volta ao estado "idle" (azul)
  - Supabase users: `ntfy_token` e `ntfy_topic` = NULL
  - Token revogado: tentativa de usar o token antigo no servidor ntfy retorna 401

---

## Fase 4: Canal 2 via pedido real

- [ ] **4.1 Pedido dispara Canal 2**

  1. Garantir que pelo menos um usuário com papel "chefia" ou "admin" tem `ntfy_topic` configurado
  2. Criar um pedido como usuário de setor (destino: chefia/admin)
  3. Verificar Supabase Dashboard → Edge Functions → send-push → Logs

  ✅ Esperado nos logs:
  ```
  [send-push] Canal 1 (WebPush): X/Y, Canal 2 (ntfy): 1/1 enviados
  [send-push][ntfy] Enviado: topic=pedidos-XXXXXXXX
  ```

  ✅ Esperado no iPhone: notificação chega no app ntfy em < 5 segundos, mesmo com CompraFácil fechado

- [ ] **4.2 Degradação graciosa (usuário sem ntfy)**

  Criar pedido quando usuário alvo não tem `ntfy_topic` configurado:
  ✅ Esperado nos logs:
  ```
  [send-push] Canal 2 (ntfy): 0/0 enviados
  ```
  Canal 1 (Web Push) continua funcionando normalmente

- [ ] **4.3 Degradação graciosa (servidor ntfy indisponível)**

  Temporariamente desconfigurar `NTFY_BASE_URL` secret no Supabase, criar pedido:
  ✅ Esperado nos logs:
  ```
  [send-push][ntfy] Canal 2 desabilitado (env vars não configuradas)
  ```
  Canal 1 continua funcionando. Reconfigurar `NTFY_BASE_URL` após o teste.

---

## Fase 5: Verificação de segurança

- [ ] **5.1 Tópico privado (sem token = acesso negado)**
  ```bash
  curl https://ntfy-comprafacil.fly.dev/pedidos-teste
  ```
  ✅ Esperado: `403 Forbidden` (auth-default-access: deny-all)

- [ ] **5.2 Token de outro usuário não acessa tópico diferente**

  Token do usuário A não deve conseguir se inscrever no tópico do usuário B
  ✅ Esperado: 403 ao tentar subscribir em `pedidos-YYYYYYY` com token de `pedidos-XXXXXXXX`

---

## Fase 6: Commit final

- [ ] **6.1 Verificar diff completo**
  ```bash
  git diff main..HEAD --stat
  ```
  ✅ Esperado: apenas os arquivos do plano de implementação listados

- [ ] **6.2 Commit de fechamento do branch**
  ```bash
  git add .
  git commit -m "feat: sistema dual-channel de notificações iOS (ntfy.sh self-hosted)

  - Servidor ntfy.sh self-hosted no Fly.io com auth e relay iOS APNs
  - Edge Function generate-ntfy-token para gestão de tokens por usuário
  - Edge Function send-push com Canal 2 ntfy paralelo ao Web Push
  - Componente NtfySetupCard com fluxo guiado de configuração em 2 passos
  - Deep link ntfy:// para configuração com 1 toque no iOS"
  ```

- [ ] **6.3 Merge para main**
  ```bash
  git checkout main
  git merge feat/ntfy-dual-channel --no-ff -m "feat: ntfy dual-channel notifications merged"
  ```

---

## Notas Operacionais

**Quota de relay iOS (ntfy.sh cloud):**
O plano gratuito permite 250 "pokes" por dia para relay APNs. Com 2-10 usuários e tráfego típico de motel, esse limite é mais que suficiente. Monitorar em: Supabase Logs → send-push. Se necessário, criar conta gratuita em ntfy.sh e configurar `upstream-access-token` no `server.yml`.

**Volumes Fly.io:**
O banco SQLite de autenticação e cache de mensagens ficam nos volumes `ntfy_data` e `ntfy_config`. Sem volumes persistentes, os tokens são perdidos a cada restart. Verificar que os volumes estão montados: `fly volumes list -a ntfy-comprafacil`.

**Redeploy após mudanças:**
```bash
cd infra/ntfy
fly deploy
```
