/* eslint-disable no-await-in-loop */
import { PassThrough } from 'stream';
import { filter } from 'lodash';
import * as superagent from 'superagent';
import proxy from 'superagent-proxy';
import { STATUS } from '@hydrooj/utils/lib/status';
import { Logger } from 'hydrooj/src/logger';
import { IBasicProvider, RemoteAccount } from '../interface';

proxy(superagent as any);
const logger = new Logger('remote/loj');

export default class LOJProvider implements IBasicProvider {
    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        if (account.cookie) this.cookie = account.cookie;
    }

    cookie: string[] = [];

    get(url: string) {
        logger.debug('get', url);
        if (!url.includes('//')) url = `${this.account.endpoint || 'https://loj.ac'}${url}`;
        const req = superagent.get(url).set('Cookie', this.cookie);
        if (this.account.proxy) return req.proxy(this.account.proxy);
        return req;
    }

    post(url: string) {
        logger.debug('post', url, this.cookie);
        if (!url.includes('//')) url = `${this.account.endpoint || 'https://api.loj.ac.cn'}${url}`;
        const req = superagent.post(url).set('Cookie', this.cookie);
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
        return this.get('/').then(({ text: html }) => !html.includes('<button class="ui button _loginAndRegisterButton_1lx9b_30">登录</button>'));
    }

    async ensureLogin() {
        if (await this.loggedIn) return true;
        logger.info('retry login');
        await this.getCsrfToken('/');
        // await this.post('/login')
        //     .set('referer', 'http://poj.org/')
        //     .send({
        //         user_id1: this.account.handle,
        //         password1: this.account.password,
        //         B1: 'login',
        //         url: '/',
        //     });
        return this.loggedIn;
    }

    async getProblem(id: string) {
        logger.info(id);
        const result = await this.post('/api/problem/getProblem')
            .send({
                displayId: +id.split('P')[1],
                localizedContentsOfAllLocales: true,
                tagsOfLocale: 'zh_CN',
                samples: true,
                judgeInfo: true,
                testData: true,
                additionalFiles: true,
            });
        if (!result.body.localizedContentsOfAllLocales) {
            return null;
        }
        const contents = {};
        const files = {};
        const images = {};
        for (const c of result.body.localizedContentsOfAllLocales) {
            let content = '';
            const sections = c.contentSections;
            for (const section of sections) {
                if (section.type === 'Sample') {
                    content += `\
\`\`\`input${section.sampleId}
${result.body.samples[section.sampleId].inputData}
\`\`\`
\`\`\`output${section.sampleId}
${result.body.samples[section.sampleId].outputData}
\`\`\`
`;
                } else {
                    content += `## ${section.sectionTitle}\n`;
                    content += `\n${section.text}\n\n`;
                }
            }
            [...content.matchAll(/!\[\]\(.*\)/g)].forEach((ele) => {
                const src = ele[0].match(/http(.*)[^)]+/)[0];
                if (images[src]) {
                    content = content.replace(src, `file://${images[src]}.png`);
                    return;
                }
                const file = new PassThrough();
                this.get(src).pipe(file);
                const fid = String.random(8);
                images[src] = fid;
                files[`${fid}.png`] = file;
                content = content.replace(src, `file://${fid}.png`);
            });
            if (content.includes('题目详见')) {
                const problemId = content.match(/\/[0-9]+/)[0].replace('/', 'P');
                content = `**题目详见 [LOJ ${problemId}](${problemId})，本题关闭提交！**`;
            }
            let locale = c.locale;
            if (locale === 'en_US') locale = 'en';
            else if (locale === 'zh_CN') locale = 'zh';
            contents[locale] = content;
        }
        const tags = result.body.tagsOfLocale.map((node) => node.name);
        const title = [
            ...filter(
                result.body.localizedContentsOfAllLocales,
                (node) => node.locale === 'zh_CN',
            ),
            ...result.body.localizedContentsOfAllLocales,
        ][0].title;
        const time = result.body.judgeInfo.timeLimit;
        const memory = result.body.judgeInfo.memoryLimit;
        return {
            title,
            data: {
                'config.yaml': Buffer.from(`time: ${time}\nmemory: ${memory}\ntype: remote_judge\nsubType: libreoj\ntarget: ${id}`),
            },
            files,
            tag: tags,
            content: JSON.stringify(contents),
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async listProblem(page: number, resync = false) {
        return [];
        // const skipCount = 0;
        // const results = await this.post('/api/problem/queryProblemSet')
        //     .send({
        //         locale: 'zh_CN',
        //         skipCount: skipCount,
        //         takeCount: 50
        //     });
        // const res = results.body.result;
        // const pli: string[] = Array.from(res.map((i) => `P${+i.meta.id.toString()}`));
        // return pli;
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
