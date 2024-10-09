import { color } from 'listr2';

export const warningBadge = color.bgYellow(' Warning ');

export function link(text: string, url: string) {
	return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}
