import { keccak256, toHex, hexToCompactSignature, isHex } from 'viem';
import { getCoderByCoinName } from '@ensdomains/address-encoder';
import { hexToBytes } from '@ensdomains/address-encoder/utils';
import { getAddress as toChecksumAddr } from 'viem';

const SNS_PROXY = 'https://sns-sdk-proxy.bonfida.workers.dev';

export const recordMap = {
	'address/60': 'ETH',
	'address/eth': 'ETH',
	'address/501': 'SOL',
	'address/sol': 'SOL',
	'address/0': 'BTC',
	'address/btc': 'BTC',
	'address/2': 'LTC',
	'address/ltc': 'LTC',
	'address/3': 'DOGE',
	'address/doge': 'DOGE',
	'text/avatar': 'pic',
	'text/url': 'url',
	'text/com.discord': 'discord',
	'text/com.twitter': 'twitter',
	'text/com.reddit': 'reddit',
	'text/org.telegram': 'telegram',
	'text/com.github': 'github',
};
export function formatAddress(_ticker, data) {
	const coder = getCoderByCoinName(_ticker.toLowerCase());
	const addr = data.toLowerCase().startsWith('0x') ? toChecksumAddr(data) : data;
	return `0x${coder.decode(address)}`;
}
export function randomRPC(APIS) {
	const RPC = APIS.split(', ');
	return RPC[Math.floor(Math.random() * RPC.length)];
}

export async function setKV(KVStore, key, val, ttl) {
	//console.log('KV Set:', key, val, ttl);
	await KVStore.put(key, val, { expirationTtl: ttl > 60 ? ttl : 60 });
	return val;
}

export async function getKV(KVStore, key) {
	return await KVStore.get(key);
}

export async function signRecord(env, domain, recType, result) {
	const signer = privateKeyToAccount(env.SIGNER_KEY);
	// \nGateway: https://${gateway}\
	const message = `Requesting Signature To Update ENS Record\n\
		\nDomain: ${domain}\
		\nResolver: eip155:1:${env.RESOLVER}\
		\nRecord Type: ${recType}\
		\nResult Hash: ${keccak256(result)}\
		\nSigned By: eip155:1:${signer.address}`;
	const sig = hexToCompactSignature(await signer.signMessage({ message: message }));
	return sig.r + sig.yParityAndS.slice(2);
}

export async function domainRegd(env, domain, ttl) {
	const key = `DOMAINCHECK_${domain.replace(".", "_")}`
	const value = await getKV(env.SOLCASA, key)
	if (value !== null) {
		console.log("KV Used:", key, value)
		return value;
	}
	const rpc = randomRPC(env.RPC_URLS);
	try {
		const result = await fetch(`${SNS_PROXY}/resolve/${domain}?rpc=${rpc}`, {
			cf: {
				cacheTtl: ttl * 20,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			const data = await result.json();
			return await setKV(env.SOLCASA, key, data.s === "ok", ttl * 60)
		}
	} catch (err) {
		console.error(domain, recordType, error.message);
	}
	return await setKV(env.SOLCASA, key, false, ttl)
}
export async function getRecord(env, domain, recordType, ttl) {
	const key = (`RECORD_${domain}/${recordType}`).replace('.', '_')
	const value = await getKV(env.SOLCASA, key)
	if (value !== null) {
		console.log("KV Used:", key, value)
		return value;
	}
	const regd = await domainRegd(env, domain, ttl)
	if (!regd) {
		return await setKV(env.SOLCASA, key, false, ttl);
	}
	const rpc = randomRPC(env.RPC_URLS);
	try {
		const result = await fetch(`${SNS_PROXY}/record-v2/${domain}/${recordType}?rpc=${rpc}`, {
			cf: {
				cacheTtl: ttl * 2,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			let data = await result.json();
			data = data.result.stale ? false : data.result.deserialized;
			return await setKV(env.SOLCASA, key, data, ttl)
		}
	} catch (err) {
		console.error(domain, recordType, error.message);
	}
	try {
		const result = await fetch(`${SNS_PROXY}/record/${domain}/${recordType}?rpc=${rpc}`, {
			cf: {
				cacheTtl: ttl * 2,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			const data = await result.json();
			return await setKV(env.SOLCASA, key, data.result, ttl)
		}
	} catch (error) {
		console.error(domain, recordType, error.message);
	}
	return await setKV(env.SOLCASA, key, false, ttl);
}

export const getContent = async (env, domain, ttl) => {
	const key = (`CONTENT_${domain}`).replace('.', '_')
	let result = await getKV(env.SOLCASA, key)
	if (result) {
		console.log("KV Used:", key, result)
		return result;
	}
	result = await domainRegd(env, domain, ttl)
	if (!result) {
		return await setKV(env.SOLCASA, key, `https://www.sns.id/search?search=${domain}&ref=sol.casa`, ttl);
	}
	result = await getRecord(env, domain, "IPFS", ttl)
	if (result) {
		if (result.startsWith('k')) {// TODO : Use CID decoder
			result = `ipns://${result}`;
		} else {
			result = `ipfs://${result}`;
		}
	} else {
		result = await getRecord(env, domain, "ARWV", ttl)
		if (result) {
			result = `ar://${result}`
		} else {
			result = await getRecord(env, domain, "SHDW", ttl)
			if (result) {
				result = `shdw://${result}`
			} else {
				result = await getRecord(env, domain, "url", ttl)
				if (result) {
					result = result.startsWith("http") ? result : atob(result)
				} else {
					result = `https://www.sns.id/domain?domain=${domain.split(".")[0]}&ref=sol.casa`
				}
			}
		}
	}
	return await setKV(env.SOLCASA, key, result, ttl)
}