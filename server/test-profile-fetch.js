
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE_NAME = process.env.INSTANCE_NAME;

const number = '5511999999999'; // Test with a likely non-existent or different number to see behavior, or use a known public number if possible. 
// Actually let's use the user's number but check if the instance is correct.
// The user said: "nao aparece o nome do cliente, só o número".
// Maybe the instance needs to sync contacts first?
// Let's try to fetch contacts list.

const remoteJid = `${number}@s.whatsapp.net`;

async function testFetchProfile() {
    console.log(`URL: ${EVOLUTION_URL}`);
    console.log(`Instance: ${INSTANCE_NAME}`);

    try {
        // Teste 1: /chat/fetchProfile
        console.log('\n--- Test 1: /chat/fetchProfile ---');
        const url1 = `${EVOLUTION_URL}/chat/fetchProfile/${INSTANCE_NAME}`;
        const res1 = await axios.post(url1, { number: remoteJid }, {
            headers: { 'apikey': EVOLUTION_API_KEY }
        });
        console.log('Result 1:', JSON.stringify(res1.data, null, 2));

        // Teste 2: /chat/fetchProfilePictureUrl
        console.log('\n--- Test 2: /chat/fetchProfilePictureUrl ---');
        const url2 = `${EVOLUTION_URL}/chat/fetchProfilePictureUrl/${INSTANCE_NAME}`;
        const res2 = await axios.post(url2, { number: remoteJid }, {
            headers: { 'apikey': EVOLUTION_API_KEY }
        });
        console.log('Result 2:', JSON.stringify(res2.data, null, 2));

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

// Adding Contact List Fetch Test
async function testFetchContacts() {
    console.log('\n--- Test 3: /contact/findContact ---');
    try {
        const url3 = `${EVOLUTION_URL}/contact/findContact/${INSTANCE_NAME}`;
        const res3 = await axios.post(url3, { number: remoteJid }, {
             headers: { 'apikey': EVOLUTION_API_KEY }
        });
        console.log('Result 3:', JSON.stringify(res3.data, null, 2));
    } catch (e) {
        console.log('Error 3:', e.response?.data || e.message);
    }
}

testFetchProfile().then(testFetchContacts);
