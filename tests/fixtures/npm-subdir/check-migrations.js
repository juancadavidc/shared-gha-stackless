// Recibe la base de comparación como primer argumento (npm la pasa tras `--`).
const base = process.argv[2];
if (!base) {
  console.error("check-migrations no recibió la base");
  process.exit(1);
}
console.log(`check-migrations contra ${base}`);
