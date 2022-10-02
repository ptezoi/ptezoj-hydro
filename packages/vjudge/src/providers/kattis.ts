/* eslint-disable no-await-in-loop */
import { PassThrough } from 'stream';
import { JSDOM } from 'jsdom';
import * as superagent from 'superagent';
import proxy from 'superagent-proxy';
import { Logger, STATUS } from 'hydrooj';
import { IBasicProvider, RemoteAccount } from '../interface';

proxy(superagent as any);
const logger = new Logger('remote/kattis');

function isElementNode(el: Node): el is Element {
    return el.nodeType === el.ELEMENT_NODE;
}

export default class KATTISProvider implements IBasicProvider {
    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        if (account.cookie) this.cookie = account.cookie;
    }

    cookie: string[] = [];

    get(url: string) {
        logger.debug('get', url);
        if (!url.startsWith('http')) url = new URL(url, this.account.endpoint || 'https://open.kattis.com').toString();
        const req = superagent.get(url).set('Cookie', this.cookie);
        if (this.account.proxy) return req.proxy(this.account.proxy);
        return req;
    }

    post(url: string) {
        logger.debug('post', url, this.cookie);
        if (!url.includes('//')) url = `${this.account.endpoint || 'https://open.kattis.com'}${url}`;
        const req = superagent.post(url).set('Cookie', this.cookie).type('form');
        if (this.account.proxy) return req.proxy(this.account.proxy);
        return req;
    }

    async getCsrfToken(url: string) {
        const { header } = await this.get(url);
        if (header['set-cookie']) {
            await this.save({ cookie: header['set-cookie'] });
            this.cookie = header['set-cookie'];
        }
        return '';
    }

    get loggedIn() {
        return this.get('/').then(({ text: html }) => !html.includes('<a href="/login" class="button button-primary button-small">Log in</a>'));
    }

    async ensureLogin() {
        if (await this.loggedIn) return true;
        logger.info('retry login');
        await this.getCsrfToken('/');
        const res = await this.get('https://open.kattis.com/login/email');
        const { window: { document } } = new JSDOM(res.text);
        const token = (document.querySelector('input[name=csrf_token]') as HTMLInputElement).value;
        await this.post('/login/email')
            .set('referer', 'https://open.kattis.com/login/email')
            .send({
                csrf_token: token,
                user: this.account.handle,
                password: this.account.password,
            });
        return this.loggedIn;
    }

    async getProblem(id: string) {
        logger.info(id);
        const res = await this.get(`/problems/${id.split('P')[1]}`);
        const { window: { document } } = new JSDOM(res.text);
        const title = document.querySelector('h1[class=book-page-heading]').textContent;
        const another = document.querySelectorAll('div[class="attribute_list-item"]');
        const time = `${+another[0].children[1].textContent.split(' ')[0] * 1000}`;
        const memory = another[1].children[1].textContent.split(' ')[0];
        const tag = [];
        for (const sNode of another) {
            if (sNode.textContent.includes('Source')) tag.push(sNode.children[1].textContent.trim());
        }
        const pDocument = document.querySelector('div[class=problembody]');
        pDocument.innerHTML = pDocument.innerHTML.replace(/<span class="tex2jax_process">\$/g, '$').replace(/\$<\/span>/g, '$');
        const images = {};
        const files = {};
        pDocument.querySelectorAll('img[src]').forEach((ele) => {
            const src = ele.getAttribute('src');
            if (images[src]) {
                ele.setAttribute('src', `file://${images[src]}.png`);
                return;
            }
            const file = new PassThrough();
            this.get(src).pipe(file);
            const fid = String.random(8);
            images[src] = fid;
            files[`${fid}.png`] = file;
            ele.setAttribute('src', `file://${fid}.png`);
        });
        let html = '';
        let lastId = 1;
        let i = 0;
        while (i < pDocument.childNodes.length) {
            const node = pDocument.childNodes[i];
            if (isElementNode(node)) {
                if (node.className === 'sample') {
                    if (node.children[0].children[0].textContent.includes('Interaction')) {
                        i++;
                        continue;
                    }
                    const inoutSample = node.children[0].children[1];
                    const input = inoutSample.children[0].children[0];
                    html += `\n\n<pre><code class="language-input${lastId}">${input.textContent}</code></pre>\n\n`;
                    const output = inoutSample.children[1].children[0];
                    html += `\n\n<pre><code class="language-output${lastId}">${output.textContent}</code></pre>\n\n`;
                    lastId++;
                } else if (node.className === 'illustration') {
                    const pic = document.createElement('p');
                    pic.innerHTML = node.children[0].outerHTML.trim();
                    const picDescription = document.createElement('p');
                    picDescription.innerHTML = node.children[1].textContent.trim();
                    html += pic.outerHTML + picDescription.outerHTML;
                } else if (node.tagName === 'PRE') {
                    html += `<pre><code>${node.innerHTML}</code></pre>`;
                } else {
                    for (const preCode of node.querySelectorAll('pre')) {
                        const pre = document.createElement('pre');
                        pre.innerHTML = `<code>${preCode.innerHTML}</code>`;
                        preCode.replaceWith(pre);
                    }
                    html += node.outerHTML.replace(/\n\n/g, '\n').replace(/\\begin{equation\*}/g, '$').replace(/\\end{equation\*}/g, '$');
                }
            } else {
                // eslint-disable-next-line no-lonely-if
                if (node.nodeName === '#text' && node.nodeValue.trim() !== '') {
                    const p = document.createElement('p');
                    p.innerHTML = '';
                    while (['#text', 'A', 'SPAN'].indexOf(pDocument.childNodes[i].nodeName) !== -1) {
                        const tNode = pDocument.childNodes[i];
                        if (isElementNode(tNode)) p.innerHTML += tNode.outerHTML;
                        else p.innerHTML += tNode.nodeValue;
                        i++;
                    }
                    html += p.outerHTML;
                }
            }
            i++;
        }
        return {
            title,
            data: {
                'config.yaml': Buffer.from(`time: ${time}\nmemory: ${memory}\ntype: remote_judge\nsubType: kattis\ntarget: ${id}`),
            },
            files,
            tag,
            content: JSON.stringify({ en: html }),
        };
    }

    async listProblem(page: number, resync = false) {
        if (resync && page > 1) return [];
        const res = await this.get(`/problems?page=${page - 1}&language=en`);
        const { window: { document } } = new JSDOM(res.text);
        return [...document.querySelector('tbody').children].map((i) => `P${i.children[0].children[0].getAttribute('href').split('/problems/')[1]}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async submitProblem(id: string, lang: string, code: string, info) {
        return '';
    }

    // eslint-disable-next-line consistent-return
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async waitForSubmission(id: string, next, end) {
        const status = STATUS.STATUS_SYSTEM_ERROR;
        const time = 0;
        const memory = 0;
        return await end({
            status,
            score: 0,
            time,
            memory,
        });
    }
}
