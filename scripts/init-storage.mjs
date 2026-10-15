import { AzureStore } from '../cloud/api/src/storage.mjs';
if (!process.env.AZURE_STORAGE_CONNECTION_STRING) throw new Error('Speicherverbindung fehlt.');
await new AzureStore(process.env.AZURE_STORAGE_CONNECTION_STRING).table('VartaMeta');
console.log('Azure-Metadatentabelle initialisiert.');
