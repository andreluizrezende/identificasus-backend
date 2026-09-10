// Ponte para a Vercel: `dist/serverless.js` so existe depois de `npm run
// build` (ver vercel.json), que a Vercel roda antes de empacotar esta funcao.
// Aponta para o build compilado, e nao para src/, para nao depender do
// esbuild da Vercel entender `emitDecoratorMetadata` — o tsc do `nest build`
// ja resolveu decorators e os aliases `@/` antes disso chegar aqui.
const { obterHandler } = require('../dist/serverless');

module.exports = async (req, res) => {
  const handler = await obterHandler();
  return handler(req, res);
};
