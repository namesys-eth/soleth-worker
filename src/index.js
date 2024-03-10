import { privateKeyToAccount } from 'viem/accounts';
import { randomRPC, setKV, getKV, signRecord, proxySol, recordMap, getContent } from './utils';
import { getCoderByCoinName } from '@ensdomains/address-encoder';
import { hexToBytes } from '@ensdomains/address-encoder/utils';
import { getAddress as toChecksumAddr, toHex } from 'viem';

//Home page cache timer, set 1 hour
const HOME_CACHE = 12;

const HOME_PAGE = 'https://namesys-eth.github.io'; // with trailing slash
// Per record cache timer,
const RECORD_CACHE = 12;
const ERROR_CACHE = 12;
// Gateway Web page cache
const PAGE_CACHE = 12;
const DATA_CACHE = 12;

// cache timer for error 404
const X404_CACHE = 13;

const cache = caches.default;
const utf8Encoder = new TextEncoder();

async function cachedOutput(cacheKey, res, timer) {
	res.headers.append('Cache-Control', `max-age=${timer ? timer : DEFAULT_CACHE}, must-revalidate`);
	res.headers.append('Date', new Date().toUTCString());
	//const tag = await crypto.subtle.digest("SHA-1", utf8Encoder.encode(Date()))//.then(t=>{})
	//res.headers.append("ETag", `"${Buffer.from(tag.slice(10)).toString('hex')}"`)
	res.headers.append('Access-Control-Allow-Origin', '*');
	if (timer) {
		await cache.put(cacheKey, res.clone());
		console.log('Cache Set:', timer, cacheKey);
	}
	return res;
}

export default {
	async fetch(request, env, ctx) {
		//return new Response("", { headers: { location: "https://sns.id" }, status: 307 })
		const url = new URL(request.url);
		const cacheKey = url.href.split("?")[0] //new Request(url.toString());
		let response = await cache.match(cacheKey);
		if (response) {
			console.log('Cache Hit:', cacheKey);
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
				response = await fetch(`${HOME_PAGE}/avatar.png`, {
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
			const _domain = url.hostname.split(".").slice(0, 2).join(".")
			const result = await getContent(env, _domain, HOME_CACHE);
			if (result) {
				const res = result.split("://")
				let gateway = ""// TODO: set default profile here, or at default
				switch (res[0]) {
					case "ipfs":
						gateway = `https://ipfs.io/ipfs/${res[1]}`
						break
					case "ipns":
						gateway = `https://ipfs.io/ipns/${res[1]}`
						break
					case "ar":
						gateway = `https://arweave.net/${res[1]}`
						break
					case "shdw":
						gateway = `https://shdw-drive.genesysgo.net/${res[1]}`
						break
					case "https":
						return Response.redirect(result, 307)
					default: {
						console.log("____REDirect")
						return Response.redirect(`https://www.sns.id/domain?domain=${_domain.split(".")[0]}`, 307)
					}
					//gateway = HOME_PAGE // set PROFILE here
					//break
					//return cachedOutput(cacheKey, Response.json({ error: 'Record Not Set' }, { status: 404 }), ERROR_CACHE)
				}

				response = await fetch(`${gateway}${url.pathname}${url.search}`, {
					cf: {
						cacheTtl: HOME_CACHE * 2,
						cacheEverything: true,
					},
				});
				console.log(response.status, "__status")
				return cachedOutput(cacheKey, new Response(response.body, {
					headers: {
						'Content-Type': response.headers.get('Content-Type'),
						'Access-Control-Allow-Credentials': "false",
						'Access-Control-Allow-Headers': "Content-Type,Range,User-Agent,X-Requested-With",
						'Access-Control-Allow-Methods': "GET, HEAD, OPTIONS",
						'Access-Control-Expose-Headers': "Content-Length,Content-Range,X-Chunked-Output,X-Stream-Output",
						'Clear-Site-Data': "cookies",
						'Content-Security-Policy': "frame-ancestors 'self'",
						'Cross-Origin-Resource-Policy': "cross-origin",
						'Permissions-Policy': "interest-cohort=()",
						'Referrer-Policy': "strict-origin-when-cross-origin",
						Server: "sol.casa",
						'Strict-Transport-Security': "max-age=31536000; includeSubDomains; preload",
						'X-Content-Type-Options': "nosniff",
						'X-Frame-Options': "SAMEORIGIN",
						'X-True-Host': `${_domain}.casa`,
						'X-Xss-Protection': "1; mode=block"
					}
				}), PAGE_CACHE);
			}
			return Response.redirect(`https://www.sns.id/domain?domain=${_domain.split(".")[0]}`, 307)
		}
		return cachedOutput(cacheKey, Response.json({ error: 'Record Not Found' }, { status: 404 }), ERROR_CACHE)
		//return cachedOutput(cacheKey, Response.json({ error: 'Not Implemented' }, { status: 404 }), 60);
	}
}
