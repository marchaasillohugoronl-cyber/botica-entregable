import { hashPassword } from '../server/auth.js';

if (!process.stdin.isTTY) throw new Error('Ejecuta este comando en una terminal interactiva.');
process.stdout.write('Contraseña del administrador (mínimo 14 caracteres, entrada oculta): ');
process.stdin.setRawMode(true);
process.stdin.resume();
let password = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (text) => {
  if (text.includes('\u0003')) process.exit(130);
  if (text.includes('\r') || text.includes('\n')) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    if (password.length < 14 || password.length > 256) {
      console.error('\nUsa entre 14 y 256 caracteres.');
      process.exitCode = 1;
      return;
    }
    console.log('\nADMIN_PASSWORD_HASH=' + (await hashPassword(password)));
    password = '';
  } else if (text === '\u007f') password = password.slice(0, -1);
  else password += text;
});
