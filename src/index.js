import { privateKeyToAccount } from 'viem/accounts';
import { randomRPC, setKV, getKV, signRecord, proxySol, recordMap } from './utils';
import { getCoderByCoinName } from '@ensdomains/address-encoder';
import { hexToBytes } from '@ensdomains/address-encoder/utils';
import { getAddress as toChecksumAddr, toHex } from 'viem';

//Home page cache timer, set 1 hour
const HOME_CACHE = 12;
const HOME_PAGE = 'https://namesys-eth.github.io/'; // with trailing slash
// Per record cache timer,
const RECORD_CACHE = 12;
// Gateway Web page cache
const PAGE_CACHE = 12;
const DATA_CACHE = 12;

// cache timer for error 404
const X404_CACHE = 13;

const cache = caches.default;
const utf8Encoder = new TextEncoder();

async function cachedOutput(key, res, timer) {
	res.headers.append('Cache-Control', `max-age=${timer ? timer : DEFAULT_CACHE}`);
	res.headers.append('Date', new Date().toUTCString());
	//const tag = await crypto.subtle.digest("SHA-1", utf8Encoder.encode(Date()))//.then(t=>{})
	//res.headers.append("ETag", `"${Buffer.from(tag.slice(10)).toString('hex')}"`)
	res.headers.append('Access-Control-Allow-Origin', '*');
	if (timer) {
		await cache.put(key, res.clone());
		console.log('Cache Set:', timer, key.url);
	}
	return res;
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const cacheKey = new Request(url.toString());
		let response = await cache.match(cacheKey);
		if (response) {
			console.log('Cache Hit:', request.url);
			return response;
		}
		const rpc = randomRPC(env.RPC_URLS);
		if (url.pathname.startsWith('/.well-known/')) {
			const _path = url.pathname.split('/').slice(3);
			const key = `DATA_${_path.join('/').replace('.', '_')}`;
			let data = await getKV(env.SOLCASA, key);
			if (data) {
				console.log('KV Used:', key);
				return cachedOutput(cacheKey, Response.json({ data: data }), DATA_CACHE);
			}
			let _domain = '';
			let _type = _path.pop(); //
			if (_type.endsWith('.json')) {
				_type = _type.substring(0, _type.length - 5);
				const rec = _path[_path.length - 1];
				const recType = recordMap[`${rec}/${_type}`];
				if (rec === 'address' && recType) {
					_path.pop();
					_domain = _path.reverse().join('.');
					data = await proxySol(env, _domain, recType, 15);
					if (data) {
						// format & sign here
						const addrCoder = getCoderByCoinName(recType.toLowerCase());
						data = data.startsWith('0x') ? toChecksumAddr(data) : data;
						console.log('0x', toHex(addrCoder.decode(data)), data, recType);
						//await setKV(env.SOLCASA, key, data, DATA_CACHE * 2)
						response = Response.json({ TEST: data, addr: url.pathname });
					}
					return cachedOutput(cacheKey, response, DATA_CACHE); // 10 seconds
				}
				if (rec === 'text' && recType) {
					_path.pop();
					_domain = _path.reverse().join('.');
					data = await proxySol(env, _domain, recType, 15);
					if (data) {
						// format & sign here
						await setKV(env.SOLCASA, key, data, DATA_CACHE * 2);
						response = Response.json({ TEST: data, addr: url.pathname });
					}
					console.log(data);
					return cachedOutput(cacheKey, response, DATA_CACHE);
				}
				response = Response.json({ error: `Record Type "${rec}/${_type}" Not Found` }, { status: 404 });
				return cachedOutput(cacheKey, response, X404_CACHE);
			}
			response = Response.json({ error: `Record Type "${_type}" Not Found` }, { status: 404 });
			return cachedOutput(cacheKey, response, X404_CACHE);
		}
		const hostLen = url.hostname.split('.').length;
		if (hostLen < 3) {
			if (url.pathname === '/favicon.ico') {
				response = await fetch(`${HOME_PAGE}avatar.png`, {
					cf: {
						cacheTtl: HOME_CACHE * 20,
						cacheEverything: true,
					},
				});
			} else {
				response = await fetch(`${HOME_PAGE}${url.pathname}${url.search}`, {
					cf: {
						cacheTtl: HOME_CACHE * 2,
						cacheEverything: true,
					},
				});
			}
			response = new Response(response.body, {
				headers: {
					'Content-Type': response.headers.get('Content-Type'),
				},
			});
			return cachedOutput(cacheKey, response, HOME_CACHE);
		}
		if (hostLen === 3) {
			const key = `${url.hostname}`.replace('.', '_');
			let value = await getKV(env.SOLCASA, key);
			if (!value) {
				value = await proxySol(env, _domain, 'IPFS', 15);
				if (value) {
					if (value.startsWith('k')) {
						value = `ipns://${value}`;
					} else {
						value = `ipfs://${value}`;
					}
				}
				if (!value) {
					value = await proxySol(env, _domain, 'ARWV', 15);
					if (value) {
						value = `ar://${value}`;
					}
				}
				if (!value) {
					value = await proxySol(env, _domain, 'url', 15);
					//return Response.redirect(value, 302)
				}
				if (value) {
					setKV(env.SOLCASA, key, value, 24);
				}
			}
			response = await fetch(value, {
				cf: {
					cacheTtl: HOME_CACHE * 2,
					cacheEverything: true,
				},
			});
			return cachedOutput(cacheKey, new Response(response.body, { headers }), 10); // 10 seconds
		}
		return cachedOutput(cacheKey, Response.json({ error: 'Not Implemented' }, { status: 404 }), 21);
	},
};
