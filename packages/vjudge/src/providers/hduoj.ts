/* eslint-disable no-await-in-loop */
import charset from 'superagent-charset';
import proxy from 'superagent-proxy';
import { STATUS } from '@hydrooj/utils/lib/status';
import { Logger } from 'hydrooj/src/logger';
import { IBasicProvider, RemoteAccount } from '../interface';
const charset = require('superagent-charset');
const superagent = charset(require('superagent'));
charset(superagent);
proxy(superagent as any);
const logger = new Logger('remote/hduoj');

export default class HDUOJProvider implements IBasicProvider {
    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        if (account.cookie) this.cookie = account.cookie;
    }

    cookie: string[] = [];

    get(url: string) {
        return url;
    }

    post(url: string) {
        return url;
    }

    async getCsrfToken(url: string) {
        return url;
    }

    async ensureLogin() {
        return '';
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
        return [];
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
            score: status === STATUS.STATUS_ACCEPTED ? 100 : 0,
            time,
            memory,
        });
    }
}
