import { realpath } from 'node:fs/promises';
import { relative, sep } from 'node:path';

export async function checkedPath(file:string,root:string) {
  const [actual,allowed]=await Promise.all([realpath(file),realpath(root)]);
  const rel=relative(allowed,actual);
  if(rel==='..'||rel.startsWith('..'+sep)||rel.startsWith(sep))throw Object.assign(new Error('Media is outside its library.'),{statusCode:403});
  return actual;
}
