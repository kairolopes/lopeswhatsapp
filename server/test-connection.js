
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load env vars from parent directory if present, or current
dotenv.config();

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'kairo2';

console.log('\n--- Teste de Conexão com Evolution API ---');
console.log('URL:', EVOLUTION_URL || 'NÃO DEFINIDA');
console.log('API Key:', EVOLUTION_API_KEY ? '******' + EVOLUTION_API_KEY.slice(-4) : 'NÃO DEFINIDA');
console.log('Instância:', INSTANCE_NAME);
console.log('------------------------------------------\n');

if (!EVOLUTION_URL || !EVOLUTION_API_KEY) {
    console.error('ERRO: As variáveis EVOLUTION_URL e EVOLUTION_API_KEY são obrigatórias.');
    console.error('Crie um arquivo .env na pasta server ou defina as variáveis no sistema.');
    process.exit(1);
}

async function testConnection() {
    try {
        // Test 1: Fetch all instances (Global check)
        console.log(`1. Tentando buscar instâncias (Global Check)...`);
        const globalUrl = `${EVOLUTION_URL}/instance/fetchInstances`;
        const headers = {
            'apikey': EVOLUTION_API_KEY,
            'Content-Type': 'application/json'
        };

        try {
            const globalResponse = await axios.get(globalUrl, { headers });
            console.log('✅ Conexão Global: SUCESSO');
            console.log(`   Instâncias encontradas: ${globalResponse.data.length || 0}`);
        } catch (error) {
            console.error('❌ Falha na Conexão Global:', error.response?.status, error.response?.data || error.message);
            console.log('   (Isso pode acontecer se a API Key for de instância específica, não global)');
        }

        // Test 2: Check Specific Instance State
        console.log(`\n2. Verificando estado da instância '${INSTANCE_NAME}'...`);
        const instanceUrl = `${EVOLUTION_URL}/instance/connectionState/${INSTANCE_NAME}`;
        
        try {
            const instanceResponse = await axios.get(instanceUrl, { headers });
            console.log(`✅ Estado da Instância: SUCESSO`);
            console.log(`   Estado: ${JSON.stringify(instanceResponse.data)}`);
        } catch (error) {
            console.error(`❌ Falha ao verificar instância:`, error.response?.status);
            console.error('   Detalhes:', error.response?.data || error.message);
            
            if (error.response?.status === 401) {
                console.error('\n🔴 DIAGNÓSTICO: ERRO 401 UNAUTHORIZED');
                console.error('   A API Key fornecida foi rejeitada pelo servidor.');
                console.error('   Verifique se:');
                console.error('   1. A EVOLUTION_API_KEY está correta.');
                console.error('   2. Se você está usando a Global API Key ou a API Key da Instância.');
            }
        }

    } catch (error) {
        console.error('Erro inesperado:', error.message);
    }
}

testConnection();
