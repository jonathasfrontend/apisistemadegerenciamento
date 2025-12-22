# 🧪 Guia de Teste - Download de Relatórios

## 🚀 Início Rápido

### 1. Iniciar o Servidor

```bash
npm run dev
```

Aguarde até ver a mensagem: `🚀 Server running on port 4000`

---

## 🔐 2. Obter Token de Autenticação

### Fazer Login

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@salao.com",
    "password": "admin123"
  }'
```

**Copie o `accessToken` da resposta para usar nos próximos testes.**

---

## 📥 3. Testar Downloads

### Teste 1: Dashboard em Excel ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/dashboard/excel?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output dashboard.xlsx
```

**Resultado esperado**: Arquivo `dashboard.xlsx` baixado na pasta atual

---

### Teste 2: Dashboard em PDF ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/dashboard/pdf?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output dashboard.pdf
```

**Resultado esperado**: Arquivo `dashboard.pdf` baixado na pasta atual

---

### Teste 3: Relatório Financeiro Completo em Excel ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/financial/complete/excel?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output relatorio_financeiro.xlsx
```

**Resultado esperado**: 
- Arquivo Excel com múltiplas abas
- Aba 1: Resumo Financeiro
- Aba 2: Receita por Período
- Aba 3: Métodos de Pagamento
- Aba 4: Serviços Lucrativos

---

### Teste 4: Relatório Financeiro em PDF ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/financial/complete/pdf?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output relatorio_financeiro.pdf
```

**Resultado esperado**: PDF formatado com seções financeiras

---

### Teste 5: Estatísticas de Agendamentos em Excel ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/appointments/stats/excel?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output agendamentos.xlsx
```

**Resultado esperado**: Excel com estatísticas de agendamentos

---

### Teste 6: Produtos Mais Vendidos em Excel ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/products/top-selling/excel?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output produtos_vendidos.xlsx
```

**Resultado esperado**: Ranking de produtos mais vendidos

---

### Teste 7: Produtos com Estoque Baixo ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/products/low-stock/excel" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output estoque_baixo.xlsx
```

**Resultado esperado**: Lista de produtos com estoque baixo

---

### Teste 8: Análise de Clientes em Excel ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/clients/analysis/excel?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output clientes_analise.xlsx
```

**Resultado esperado**: Top clientes e estatísticas

---

### Teste 9: Clientes Inativos ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/clients/inactive/excel?daysInactive=60" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output clientes_inativos.xlsx
```

**Resultado esperado**: Lista de clientes sem visita há 60+ dias

---

### Teste 10: Programa de Fidelidade ✅

```bash
curl -X GET "http://localhost:4000/api/v1/reports/download/clients/loyalty/excel" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  --output programa_fidelidade.xlsx
```

**Resultado esperado**: Top clientes fiéis com pontos

---

## 🧪 Testando com Postman

### Configuração Rápida

1. **Importar Coleção**
   - Abra o Postman
   - Clique em "Import"
   - Selecione `postman_collection.json`

2. **Configurar Token**
   - Execute "Auth > Login"
   - O token será salvo automaticamente
   - Todas as outras requisições usarão esse token

3. **Testar Downloads**
   - Navegue até "Reports > Downloads"
   - Selecione qualquer relatório
   - Clique em "Send and Download"
   - O arquivo será baixado automaticamente

---

## 🌐 Testando no Navegador

### Método 1: Abertura Direta

1. Faça login e copie o token
2. Cole a URL no navegador (substituindo TOKEN e datas):

```
http://localhost:4000/api/v1/reports/download/dashboard/excel?startDate=2025-12-01&endDate=2025-12-31
```

3. Abra as Ferramentas do Desenvolvedor (F12)
4. Na aba Console, execute:

```javascript
fetch('http://localhost:4000/api/v1/reports/download/dashboard/excel?startDate=2025-12-01&endDate=2025-12-31', {
  headers: { 'Authorization': 'Bearer SEU_TOKEN_AQUI' }
})
.then(response => response.blob())
.then(blob => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dashboard.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
});
```

---

## ✅ Checklist de Verificação

Após cada teste, verifique:

### Excel
- [ ] Arquivo baixado com sucesso
- [ ] Abre sem erros no Excel/LibreOffice
- [ ] Cabeçalhos formatados (azul, negrito)
- [ ] Dados corretos e formatados
- [ ] Moeda: R$ X.XXX,XX
- [ ] Datas no formato DD/MM/AAAA
- [ ] Colunas com largura adequada

### PDF
- [ ] Arquivo baixado com sucesso
- [ ] Abre sem erros no leitor PDF
- [ ] Título formatado e visível
- [ ] Seções separadas por linhas
- [ ] Rodapé com data/hora de geração
- [ ] Texto legível e bem alinhado

---

## 🐛 Resolução de Problemas

### Erro 401 - Unauthorized
**Problema**: Token inválido ou expirado
**Solução**: Faça login novamente e obtenha um novo token

### Erro 400 - Bad Request
**Problema**: Parâmetros obrigatórios faltando
**Solução**: Verifique se `startDate` e `endDate` estão corretos

### Erro 500 - Internal Server Error
**Problema**: Erro no servidor
**Solução**: 
1. Verifique os logs do servidor
2. Confirme que há dados no período solicitado
3. Verifique a conexão com o banco de dados

### Arquivo não baixa
**Problema**: Navegador não inicia download
**Solução**: 
1. Use o método JavaScript acima
2. Ou use curl/Postman
3. Verifique se o CORS está configurado

### Arquivo corrompido
**Problema**: Arquivo não abre
**Solução**:
1. Verifique se o download foi completo
2. Tente novamente
3. Teste com curl para garantir que o arquivo é válido

---

## 📊 Dados de Teste

Se o banco estiver vazio, execute o seed:

```bash
npm run prisma:seed
```

Isso criará:
- Usuários de teste
- Clientes
- Serviços
- Produtos
- Agendamentos
- Pagamentos

---

## 🎯 Próximos Passos

Após confirmar que todos os testes passam:

1. ✅ Integrar com o frontend
2. ✅ Adicionar botões de download na UI
3. ✅ Implementar loading states
4. ✅ Adicionar tratamento de erros
5. ✅ Testar em diferentes navegadores
6. ✅ Testar em dispositivos móveis
7. ✅ Documentar para o time frontend

---

## 📝 Notas

- Todos os relatórios requerem autenticação
- Alguns relatórios requerem parâmetros de data
- Os arquivos são gerados em tempo real (não cache)
- Nomes de arquivo incluem timestamp para evitar conflitos
- Formato de data: YYYY-MM-DD

---

## 🎉 Conclusão

Se todos os testes acima passarem, a implementação está completa e pronta para uso!

**Status**: ✅ Implementação Concluída
**Data**: 11 de dezembro de 2025
**Testes**: 10/10 endpoints implementados
