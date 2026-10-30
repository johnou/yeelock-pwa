#!/usr/bin/env python3
"""Retrieve this account's lock credentials using the Yeelock email login API.

Based on https://github.com/codyc1515/ha-yeelock/pull/10 and
https://github.com/aso824/yeehack. Credentials are not saved by this script.
"""
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.yeeloc.com'


def request_json(request):
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Yeelock returned HTTP {error.code}. Check your account details or try again later.') from None
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise RuntimeError(f'Could not reach Yeelock or read its response ({type(error).__name__}).') from None


def main():
    print('Sign in with the email and password linked to your existing Yeelock account.')
    print('This contacts Yeelock and may sign you out of the official app. Nothing is saved by this script.\n')
    email = input('Yeelock email: ').strip()
    password = getpass.getpass('Yeelock password: ')
    if not email or not password:
        raise RuntimeError('Email and password are required.')
    params = urllib.parse.urlencode({'account': email, 'password': password})
    login = request_json(urllib.request.Request(
        f'{BASE}/v2/auth/by/password?{params}', data=b'', method='POST',
        headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
    ))
    del password, params
    data = login.get('data') if isinstance(login, dict) else None
    token = data.get('access_token') if isinstance(data, dict) else None
    if not isinstance(token, str) or not token:
        raise RuntimeError('Yeelock did not return an access token. Check your credentials; the email login API may have changed.')
    locks = request_json(urllib.request.Request(
        f'{BASE}/lock', headers={'Authorization': f'Bearer {token}'},
    ))
    if not isinstance(locks, list):
        raise RuntimeError('Yeelock returned an unexpected lock list. Its API may have changed.')
    if not locks:
        print('No locks were returned for this account.')
        return
    print('\nKeep these keys private. Enter each one in the PWA on your Android device.\n')
    for lock in locks:
        if not isinstance(lock, dict):
            continue
        print(f"Name: {lock.get('lock_name', 'Unknown')}")
        print(f"Serial number: {lock.get('lock_sn', 'Unavailable')}")
        print(f"Signing key: {lock.get('ble_sign_key', 'Unavailable')}\n")


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyboardInterrupt) as error:
        print(f'\n{error or "Cancelled."}', file=sys.stderr)
        sys.exit(1)
