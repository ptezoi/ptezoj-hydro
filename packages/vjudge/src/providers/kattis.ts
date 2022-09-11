/* eslint-disable no-await-in-loop */
import { JSDOM } from 'jsdom';
import * as superagent from 'superagent';
import proxy from 'superagent-proxy';
import { STATUS } from '@hydrooj/utils/lib/status';
import { Logger } from 'hydrooj/src/logger';
import { IBasicProvider, RemoteAccount } from '../interface';

proxy(superagent as any);
const logger = new Logger('remote/kattis');

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
        const files = {};
        const tag = [];
        return {
            title: '',
            data: {
                'config.yaml': Buffer.from(`target: ${id}`),
            },
            files,
            tag,
            content: JSON.stringify(''),
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async listProblem(page: number, resync = false) {
        if (resync && page > 1) return [];
        const res = await this.get(`/problems?page=${page - 1}&language=en`);
        const { window: { document } } = new JSDOM(res.text);
        return [...document.querySelector('tbody').children].map((i) => i.children[0].children[0].getAttribute('href').split('/problems/')[1]);
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
