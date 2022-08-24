import 'hydrooj';

import * as superagent from 'superagent';

declare module 'hydrooj' {
    interface SystemKeys {
        'login-with-google.id': string,
        'login-with-google.secret': string,
    }
    interface Lib {
        oauth_google: typeof import('./lib'),
    }
}

async function get() {
    const { system, token } = global.Hydro.model;
    const [appid, url, [state]] = await Promise.all([
        system.get('login-with-google.id'),
        system.get('server.url'),
        token.add(token.TYPE_OAUTH, 600, { redirect: this.request.referer }),
    ]);
    // eslint-disable-next-line max-len
    this.response.redirect = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${appid}&response_type=code&redirect_uri=${url}oauth/google/callback&scope=https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile&state=${state}`;
}

function unescapedString(escapedString: string) {
    escapedString += new Array(5 - (escapedString.length % 4)).join('=');
    return escapedString.replace(/-/g, '+').replace(/_/g, '/');
}

function decodeJWT(idToken: string) {
    const token = idToken.split('.');
    if (token.length !== 3) throw new Error('Invalid idToken');
    try {
        const headerSegment = JSON.parse(Buffer.from(token[0], 'base64').toString('utf8'));
        const payloadSegment = JSON.parse(Buffer.from(token[1], 'base64').toString('utf8'));
        const signature = unescapedString(token[2]);
        return {
            dataToSign: [token[0], token[1]].join('.'),
            header: headerSegment,
            payload: payloadSegment,
            signature,
        };
    } catch (e) {
        throw new Error('Invalid payload');
    }
}

async function callback({
    state, code, error,
}) {
    const { system, token } = global.Hydro.model;
    const { UserFacingError } = global.Hydro.error;
    if (error) throw new UserFacingError(error);
    const [
        [appid, secret, url],
        s,
    ] = await Promise.all([
        system.getMany([
            'login-with-google.id', 'login-with-google.secret', 'server.url',
        ]),
        token.get(state, token.TYPE_OAUTH),
    ]);
    const res = await superagent.post('https://oauth2.googleapis.com/token')
        .send({
            client_id: appid,
            client_secret: secret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: `${url}oauth/google/callback`,
        });
    const payload = decodeJWT(res.body.id_token).payload;
    await token.del(state, token.TYPE_OAUTH);
    this.response.redirect = s.redirect;
    return {
        // TODO use openid
        _id: payload.email,
        email: payload.email,
        uname: [payload.given_name, payload.name, payload.family_name],
        viewLang: payload.locale.replace('-', '_'),
    };
}

global.Hydro.lib.oauth_google = {
    text: 'Login with Google',
    callback,
    get,
};
