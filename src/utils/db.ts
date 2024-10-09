import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const a = 'aes-256-cbc';
const n = statSync(import.meta.dirname);
const k = `${n.rdev}${n.birthtimeMs}${n.nlink}${n.gid}`;
const l = createHash('md5').update(k).digest();

function e(e: string, f: string) {
	const c = createCipheriv(a, createHash('sha-256').update(f).digest(), l);
	return c.update(e, 'utf8', 'hex') + c.final('hex');
}

function d(g: string, h: string) {
	const d = createDecipheriv(a, createHash('sha-256').update(h).digest(), l);
	return d.update(g, 'hex', 'utf8') + d.final('utf8');
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
			path.resolve(this.path, Buffer.from(e(field, field)).toString('base64')),
			Buffer.from(e(`${value}`, field)),
			{ encoding: 'binary' },
		);
	}

	get(field: string) {
		try {
			return d(
				Buffer.from(
					readFileSync(
						path.resolve(
							this.path,
							Buffer.from(e(field, field)).toString('base64'),
						),
					),
				).toString(),
				field,
			);
		} catch {
			return null;
		}
	}
}
