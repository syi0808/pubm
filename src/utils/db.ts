import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const a = 'aes-256-cbc';
const iv = createHash('md5')
	.update(import.meta.filename)
	.digest();

function e(t: string, k: string) {
	const c = createCipheriv(a, createHash('sha-256').update(k).digest(), iv);
	return c.update(t, 'utf8', 'hex') + c.final('hex');
}

function d(text: string, key: string) {
	const d = createDecipheriv(a, createHash('sha-256').update(key).digest(), iv);
	return d.update(text, 'hex', 'utf8') + d.final('utf8');
}

export class Db {
	path = path.resolve(import.meta.dirname, '.pubm');

	constructor() {
		try {
			if (!statSync(this.path).isDirectory()) {
				mkdirSync(this.path);
			}
		} catch {
			mkdirSync(this.path);
		}
	}

	set(field: string, value: unknown) {
		writeFileSync(
			path.resolve(this.path, Buffer.from(iv + field).toString('base64')),
			Buffer.from(e(`${iv}${value}`, field)),
			{ encoding: 'binary' },
		);
	}

	get(field: string) {
		return d(
			Buffer.from(
				readFileSync(
					path.resolve(this.path, Buffer.from(field).toString('base64')),
				),
			).toString(),
			field,
		);
	}
}
