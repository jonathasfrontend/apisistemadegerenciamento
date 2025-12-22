# 🎨 Guia de Integração Frontend - Download de Relatórios

## 📋 Índice

1. [Exemplos JavaScript Vanilla](#javascript-vanilla)
2. [Exemplos React](#react)
3. [Exemplos Vue.js](#vuejs)
4. [Exemplos Angular](#angular)
5. [Componentes Prontos](#componentes-prontos)
6. [Tratamento de Erros](#tratamento-de-erros)
7. [Loading States](#loading-states)

---

## 🟨 JavaScript Vanilla

### Função Genérica de Download

```javascript
/**
 * Faz download de um relatório
 * @param {string} endpoint - URL do endpoint
 * @param {string} filename - Nome do arquivo para salvar
 * @param {string} token - Token JWT de autenticação
 */
async function downloadReport(endpoint, filename, token) {
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    return { success: true };
  } catch (error) {
    console.error('Erro ao baixar relatório:', error);
    return { success: false, error: error.message };
  }
}

// Uso
const token = localStorage.getItem('authToken');
downloadReport(
  'http://localhost:4000/api/v1/reports/download/dashboard/excel?startDate=2025-12-01&endDate=2025-12-31',
  'dashboard.xlsx',
  token
);
```

### Exemplo com UI

```html
<!DOCTYPE html>
<html>
<head>
  <title>Download de Relatórios</title>
  <style>
    .download-button {
      padding: 10px 20px;
      margin: 5px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .excel { background: #1D6F42; color: white; }
    .pdf { background: #DC3545; color: white; }
    .loading { opacity: 0.6; cursor: wait; }
  </style>
</head>
<body>
  <h2>Relatórios</h2>
  
  <div>
    <label>Data Início:</label>
    <input type="date" id="startDate" value="2025-12-01">
    
    <label>Data Fim:</label>
    <input type="date" id="endDate" value="2025-12-31">
  </div>

  <div>
    <h3>Dashboard</h3>
    <button class="download-button excel" onclick="downloadDashboard('excel')">
      📊 Excel
    </button>
    <button class="download-button pdf" onclick="downloadDashboard('pdf')">
      📄 PDF
    </button>
  </div>

  <div id="message"></div>

  <script>
    const API_BASE = 'http://localhost:4000/api/v1';
    const token = localStorage.getItem('authToken');

    async function downloadDashboard(format) {
      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;
      const messageEl = document.getElementById('message');
      
      const button = event.target;
      button.classList.add('loading');
      button.disabled = true;
      messageEl.textContent = 'Baixando...';

      const endpoint = `${API_BASE}/reports/download/dashboard/${format}?startDate=${startDate}&endDate=${endDate}`;
      const filename = `dashboard.${format}`;

      const result = await downloadReport(endpoint, filename, token);

      button.classList.remove('loading');
      button.disabled = false;

      if (result.success) {
        messageEl.textContent = '✅ Download concluído!';
        messageEl.style.color = 'green';
      } else {
        messageEl.textContent = `❌ Erro: ${result.error}`;
        messageEl.style.color = 'red';
      }

      setTimeout(() => {
        messageEl.textContent = '';
      }, 3000);
    }

    // Função downloadReport aqui (mesma do exemplo anterior)
  </script>
</body>
</html>
```

---

## ⚛️ React

### Hook Customizado

```jsx
// hooks/useReportDownload.js
import { useState } from 'react';
import axios from 'axios';

export const useReportDownload = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const downloadReport = async (reportType, format, params = {}) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('authToken');
      const response = await axios.get(
        `/api/v1/reports/download/${reportType}/${format}`,
        {
          params,
          responseType: 'blob',
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      // Criar link de download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${reportType}_${Date.now()}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setLoading(false);
      return { success: true };
    } catch (err) {
      setError(err.response?.data?.message || 'Erro ao baixar relatório');
      setLoading(false);
      return { success: false, error: err };
    }
  };

  return { downloadReport, loading, error };
};
```

### Componente de Botão

```jsx
// components/DownloadButton.jsx
import React from 'react';
import { useReportDownload } from '../hooks/useReportDownload';

const DownloadButton = ({ reportType, format, params, children }) => {
  const { downloadReport, loading, error } = useReportDownload();

  const handleDownload = async () => {
    await downloadReport(reportType, format, params);
  };

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={loading}
        className={`btn btn-${format === 'excel' ? 'success' : 'danger'}`}
      >
        {loading ? '⏳ Baixando...' : children}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
};

export default DownloadButton;
```

### Componente Completo de Relatórios

```jsx
// pages/Reports.jsx
import React, { useState } from 'react';
import DownloadButton from '../components/DownloadButton';
import './Reports.css';

const Reports = () => {
  const [startDate, setStartDate] = useState('2025-12-01');
  const [endDate, setEndDate] = useState('2025-12-31');

  const params = { startDate, endDate };

  return (
    <div className="reports-container">
      <h1>📊 Relatórios</h1>

      <div className="date-picker">
        <label>
          Data Início:
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label>
          Data Fim:
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>

      <div className="report-section">
        <h2>Dashboard Geral</h2>
        <div className="button-group">
          <DownloadButton
            reportType="dashboard"
            format="excel"
            params={params}
          >
            📊 Excel
          </DownloadButton>
          <DownloadButton
            reportType="dashboard"
            format="pdf"
            params={params}
          >
            📄 PDF
          </DownloadButton>
        </div>
      </div>

      <div className="report-section">
        <h2>Relatório Financeiro</h2>
        <div className="button-group">
          <DownloadButton
            reportType="financial/complete"
            format="excel"
            params={params}
          >
            📊 Excel Completo
          </DownloadButton>
          <DownloadButton
            reportType="financial/complete"
            format="pdf"
            params={params}
          >
            📄 PDF
          </DownloadButton>
        </div>
      </div>

      <div className="report-section">
        <h2>Agendamentos</h2>
        <div className="button-group">
          <DownloadButton
            reportType="appointments/stats"
            format="excel"
            params={params}
          >
            📊 Estatísticas Excel
          </DownloadButton>
          <DownloadButton
            reportType="appointments/stats"
            format="pdf"
            params={params}
          >
            📄 Estatísticas PDF
          </DownloadButton>
        </div>
      </div>

      <div className="report-section">
        <h2>Produtos</h2>
        <div className="button-group">
          <DownloadButton
            reportType="products/top-selling"
            format="excel"
            params={params}
          >
            📊 Mais Vendidos (Excel)
          </DownloadButton>
          <DownloadButton
            reportType="products/low-stock"
            format="excel"
            params={{}}
          >
            📊 Estoque Baixo (Excel)
          </DownloadButton>
        </div>
      </div>

      <div className="report-section">
        <h2>Clientes</h2>
        <div className="button-group">
          <DownloadButton
            reportType="clients/analysis"
            format="excel"
            params={params}
          >
            📊 Análise (Excel)
          </DownloadButton>
          <DownloadButton
            reportType="clients/inactive"
            format="excel"
            params={{ daysInactive: 60 }}
          >
            📊 Inativos (Excel)
          </DownloadButton>
          <DownloadButton
            reportType="clients/loyalty"
            format="excel"
            params={{}}
          >
            📊 Fidelidade (Excel)
          </DownloadButton>
        </div>
      </div>
    </div>
  );
};

export default Reports;
```

### CSS

```css
/* Reports.css */
.reports-container {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.date-picker {
  display: flex;
  gap: 20px;
  margin-bottom: 30px;
  padding: 20px;
  background: #f5f5f5;
  border-radius: 8px;
}

.date-picker label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.date-picker input {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.report-section {
  margin-bottom: 30px;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
}

.report-section h2 {
  margin-top: 0;
  color: #333;
}

.button-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: opacity 0.2s;
}

.btn:hover:not(:disabled) {
  opacity: 0.8;
}

.btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.btn-success {
  background: #1D6F42;
  color: white;
}

.btn-danger {
  background: #DC3545;
  color: white;
}

.error {
  color: red;
  margin-left: 10px;
  font-size: 12px;
}
```

---

## 🟢 Vue.js

### Composable

```javascript
// composables/useReportDownload.js
import { ref } from 'vue';
import axios from 'axios';

export function useReportDownload() {
  const loading = ref(false);
  const error = ref(null);

  const downloadReport = async (reportType, format, params = {}) => {
    loading.value = true;
    error.value = null;

    try {
      const token = localStorage.getItem('authToken');
      const response = await axios({
        url: `/api/v1/reports/download/${reportType}/${format}`,
        method: 'GET',
        params,
        responseType: 'blob',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${reportType.replace('/', '_')}_${Date.now()}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      loading.value = false;
      return { success: true };
    } catch (err) {
      error.value = err.response?.data?.message || 'Erro ao baixar relatório';
      loading.value = false;
      return { success: false, error: err };
    }
  };

  return {
    downloadReport,
    loading,
    error
  };
}
```

### Componente

```vue
<!-- components/ReportsPage.vue -->
<template>
  <div class="reports-container">
    <h1>📊 Relatórios</h1>

    <div class="date-picker">
      <label>
        Data Início:
        <input type="date" v-model="startDate" />
      </label>
      <label>
        Data Fim:
        <input type="date" v-model="endDate" />
      </label>
    </div>

    <div class="report-section">
      <h2>Dashboard Geral</h2>
      <div class="button-group">
        <button
          @click="download('dashboard', 'excel')"
          :disabled="loading"
          class="btn btn-success"
        >
          {{ loading ? '⏳ Baixando...' : '📊 Excel' }}
        </button>
        <button
          @click="download('dashboard', 'pdf')"
          :disabled="loading"
          class="btn btn-danger"
        >
          {{ loading ? '⏳ Baixando...' : '📄 PDF' }}
        </button>
      </div>
      <span v-if="error" class="error">{{ error }}</span>
    </div>

    <div class="report-section">
      <h2>Relatório Financeiro</h2>
      <div class="button-group">
        <button
          @click="download('financial/complete', 'excel')"
          :disabled="loading"
          class="btn btn-success"
        >
          📊 Excel Completo
        </button>
        <button
          @click="download('financial/complete', 'pdf')"
          :disabled="loading"
          class="btn btn-danger"
        >
          📄 PDF
        </button>
      </div>
    </div>

    <!-- Mais seções aqui -->
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useReportDownload } from '@/composables/useReportDownload';

const startDate = ref('2025-12-01');
const endDate = ref('2025-12-31');

const { downloadReport, loading, error } = useReportDownload();

const download = async (reportType, format) => {
  await downloadReport(reportType, format, {
    startDate: startDate.value,
    endDate: endDate.value
  });
};
</script>

<style scoped>
/* Mesmo CSS do exemplo React */
</style>
```

---

## 🅰️ Angular

### Service

```typescript
// services/report-download.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ReportDownloadService {
  private apiUrl = 'http://localhost:4000/api/v1';

  constructor(private http: HttpClient) {}

  downloadReport(
    reportType: string,
    format: 'excel' | 'pdf',
    params: any = {}
  ): Observable<Blob> {
    const token = localStorage.getItem('authToken');
    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`
    });

    return this.http.get(
      `${this.apiUrl}/reports/download/${reportType}/${format}`,
      {
        params,
        headers,
        responseType: 'blob'
      }
    );
  }

  triggerDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}
```

### Component

```typescript
// components/reports/reports.component.ts
import { Component } from '@angular/core';
import { ReportDownloadService } from '../../services/report-download.service';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.css']
})
export class ReportsComponent {
  startDate = '2025-12-01';
  endDate = '2025-12-31';
  loading = false;
  error: string | null = null;

  constructor(private reportService: ReportDownloadService) {}

  downloadReport(reportType: string, format: 'excel' | 'pdf'): void {
    this.loading = true;
    this.error = null;

    const params = {
      startDate: this.startDate,
      endDate: this.endDate
    };

    this.reportService.downloadReport(reportType, format, params)
      .subscribe({
        next: (blob) => {
          const filename = `${reportType.replace('/', '_')}_${Date.now()}.${format}`;
          this.reportService.triggerDownload(blob, filename);
          this.loading = false;
        },
        error: (err) => {
          this.error = 'Erro ao baixar relatório';
          this.loading = false;
          console.error(err);
        }
      });
  }
}
```

```html
<!-- reports.component.html -->
<div class="reports-container">
  <h1>📊 Relatórios</h1>

  <div class="date-picker">
    <label>
      Data Início:
      <input type="date" [(ngModel)]="startDate" />
    </label>
    <label>
      Data Fim:
      <input type="date" [(ngModel)]="endDate" />
    </label>
  </div>

  <div class="report-section">
    <h2>Dashboard Geral</h2>
    <div class="button-group">
      <button
        (click)="downloadReport('dashboard', 'excel')"
        [disabled]="loading"
        class="btn btn-success"
      >
        {{ loading ? '⏳ Baixando...' : '📊 Excel' }}
      </button>
      <button
        (click)="downloadReport('dashboard', 'pdf')"
        [disabled]="loading"
        class="btn btn-danger"
      >
        {{ loading ? '⏳ Baixando...' : '📄 PDF' }}
      </button>
    </div>
    <span *ngIf="error" class="error">{{ error }}</span>
  </div>
</div>
```

---

## 🎁 Componentes Prontos

### Botão com Ícone Animado

```jsx
// DownloadButtonAnimated.jsx
import React, { useState } from 'react';
import './DownloadButtonAnimated.css';

const DownloadButtonAnimated = ({ onDownload, format, label }) => {
  const [downloading, setDownloading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleClick = async () => {
    setDownloading(true);
    try {
      await onDownload();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (error) {
      console.error(error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      className={`download-btn ${format} ${downloading ? 'downloading' : ''} ${success ? 'success' : ''}`}
      onClick={handleClick}
      disabled={downloading}
    >
      {downloading && <span className="spinner"></span>}
      {success && <span className="checkmark">✓</span>}
      {!downloading && !success && label}
    </button>
  );
};

export default DownloadButtonAnimated;
```

```css
/* DownloadButtonAnimated.css */
.download-btn {
  padding: 12px 24px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.3s;
  position: relative;
  min-width: 120px;
}

.download-btn.excel {
  background: linear-gradient(135deg, #1D6F42 0%, #2A9D5F 100%);
  color: white;
}

.download-btn.pdf {
  background: linear-gradient(135deg, #DC3545 0%, #E74C3C 100%);
  color: white;
}

.download-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.download-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.download-btn.downloading {
  background: #6c757d;
}

.download-btn.success {
  background: #28a745;
  animation: pulse 0.5s;
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #ffffff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.checkmark {
  font-size: 20px;
  animation: scaleIn 0.3s;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

@keyframes scaleIn {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
```

---

## ⚠️ Tratamento de Erros

### Função Completa com Tratamento

```javascript
async function downloadReportWithErrorHandling(endpoint, filename, token) {
  try {
    // Validações iniciais
    if (!token) {
      throw new Error('Token de autenticação não encontrado. Faça login novamente.');
    }

    if (!navigator.onLine) {
      throw new Error('Sem conexão com a internet.');
    }

    // Fazer requisição
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Verificar status
    if (response.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    if (response.status === 403) {
      throw new Error('Você não tem permissão para acessar este relatório.');
    }

    if (response.status === 400) {
      const error = await response.json();
      throw new Error(error.message || 'Parâmetros inválidos.');
    }

    if (!response.ok) {
      throw new Error(`Erro no servidor: ${response.status}`);
    }

    // Verificar tipo de conteúdo
    const contentType = response.headers.get('content-type');
    if (!contentType || (!contentType.includes('excel') && !contentType.includes('pdf'))) {
      throw new Error('Formato de arquivo inválido.');
    }

    // Download
    const blob = await response.blob();
    
    if (blob.size === 0) {
      throw new Error('Arquivo vazio. Pode não haver dados para o período selecionado.');
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return {
      success: true,
      message: 'Download concluído com sucesso!'
    };

  } catch (error) {
    console.error('Erro no download:', error);
    
    return {
      success: false,
      error: error.message,
      type: error.name
    };
  }
}
```

### Componente com Notificações

```jsx
// ReportDownloadWithNotification.jsx
import React, { useState } from 'react';
import { toast } from 'react-toastify'; // ou sua lib de notificações

const ReportDownload = () => {
  const [loading, setLoading] = useState(false);

  const handleDownload = async (reportType, format) => {
    setLoading(true);
    
    const loadingToast = toast.loading('Preparando download...');

    try {
      const result = await downloadReportWithErrorHandling(
        `/api/v1/reports/download/${reportType}/${format}?startDate=2025-12-01&endDate=2025-12-31`,
        `${reportType}.${format}`,
        localStorage.getItem('authToken')
      );

      if (result.success) {
        toast.update(loadingToast, {
          render: '✅ Download concluído!',
          type: 'success',
          isLoading: false,
          autoClose: 3000
        });
      } else {
        toast.update(loadingToast, {
          render: `❌ ${result.error}`,
          type: 'error',
          isLoading: false,
          autoClose: 5000
        });
      }
    } catch (error) {
      toast.update(loadingToast, {
        render: '❌ Erro inesperado ao baixar relatório',
        type: 'error',
        isLoading: false,
        autoClose: 5000
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={() => handleDownload('dashboard', 'excel')} disabled={loading}>
      {loading ? 'Baixando...' : 'Download Excel'}
    </button>
  );
};
```

---

## 🔄 Loading States

### Loading Overlay

```jsx
// LoadingOverlay.jsx
import React from 'react';
import './LoadingOverlay.css';

const LoadingOverlay = ({ show, message = 'Gerando relatório...' }) => {
  if (!show) return null;

  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <div className="loading-spinner"></div>
        <p>{message}</p>
      </div>
    </div>
  );
};

export default LoadingOverlay;
```

```css
/* LoadingOverlay.css */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.loading-content {
  background: white;
  padding: 30px;
  border-radius: 8px;
  text-align: center;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 15px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

---

## 📝 Notas Finais

### Boas Práticas

1. ✅ Sempre valide o token antes de fazer requisições
2. ✅ Mostre feedback visual durante o download
3. ✅ Trate todos os erros possíveis
4. ✅ Use nomes de arquivo descritivos
5. ✅ Adicione timestamps aos nomes de arquivo
6. ✅ Teste em diferentes navegadores
7. ✅ Considere limites de tamanho de arquivo
8. ✅ Implemente retry logic para falhas de rede

### Checklist de Implementação Frontend

- [ ] Escolher framework (React, Vue, Angular, etc.)
- [ ] Configurar axios ou fetch
- [ ] Criar serviço/composable/hook de download
- [ ] Implementar componentes de UI
- [ ] Adicionar loading states
- [ ] Implementar tratamento de erros
- [ ] Adicionar notificações (toast/snackbar)
- [ ] Testar com todos os relatórios
- [ ] Testar com diferentes formatos (Excel/PDF)
- [ ] Testar tratamento de erros (sem internet, token expirado, etc.)
- [ ] Documentar para o time

---

**Pronto para começar! 🚀**

Escolha os exemplos mais adequados ao seu projeto e adapte conforme necessário.
