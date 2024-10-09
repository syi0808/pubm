import { color } from 'listr2';

export const warningBadge = color.bgYellow(' Warning ');

export function link(text: string, url: string) {
	return `\e]8;;${url}\e\\${text}\e]8;;\e\\`;
}
