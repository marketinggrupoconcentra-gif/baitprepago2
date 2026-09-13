/**
 * scripts/get-refresh-token.mjs — obtiene el refresh token OAuth de Google Ads.
 *
 * Uso:
 *   node --env-file=.env.local scripts/get-refresh-token.mjs
 * Requiere GOOGLE_ADS_OAUTH_CLIENT_ID y GOOGLE_ADS_OAUTH_CLIENT_SECRET en el entorno
 * (nunca hardcodear credenciales en el repo).
 */
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import url from 'url';

const CLIENT_ID = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('✗ Define GOOGLE_ADS_OAUTH_CLIENT_ID y GOOGLE_ADS_OAUTH_CLIENT_SECRET en .env.local');
  process.exit(1);
}

async function main() {
  const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, 'http://localhost:3000/oauth2callback');

  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: 'https://www.googleapis.com/auth/adwords',
    prompt: 'consent', // Fuerza a pedir un nuevo refresh token
  });

  console.log('===================================================');
  console.log('Abre la siguiente URL en tu navegador y autoriza:');
  console.log(authorizeUrl);
  console.log('===================================================');

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url && req.url.startsWith('/oauth2callback')) {
        const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
        const code = qs.get('code');
        if (code) {
          res.end('Autorizacion completada. Puedes cerrar esta pestana y revisar tu terminal.');
          server.close();
          const { tokens } = await oAuth2Client.getToken(code);
          console.log('\n✅ Agrega esto a tu .env.local / Vercel:');
          console.log(`GOOGLE_ADS_REFRESH_TOKEN="${tokens.refresh_token}"`);
          if (!tokens.refresh_token) {
            console.log('⚠️ Google no regresó refresh_token: revoca el acceso a esta app en tu cuenta y vuelve a correr el script.');
          }
          process.exit(0);
        }
      }
    } catch (e) {
      console.error(e);
      res.end('Ocurrio un error, revisa la terminal.');
      server.close();
    }
  }).listen(3000, () => {
    console.log('Esperando callback en http://localhost:3000/oauth2callback ...');
  });
}

main();
