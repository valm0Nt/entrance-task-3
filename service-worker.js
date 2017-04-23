'use strict';
/**
 * @file
 * Сервис-воркер, обеспечивающий оффлайновую работу избранного
 */

const CACHE_VERSION = '1.0.2-test';
const filesForCache = [
    './assets/blocks.js',
    './assets/star.svg',
    './assets/style.css',
    './assets/templates.js',
    './vendor/bem-components-dist-5.0.0/touch-phone/bem-components.dev.css',
    './vendor/bem-components-dist-5.0.0/touch-phone/bem-components.dev.js',
    './vendor/kv-keeper.js-1.0.4/kv-keeper.js',
    './vendor/kv-keeper.js-1.0.4/kv-keeper.typedef.js',
    './gifs.html',
];
const gifsForWrite = [];

importScripts('./vendor/kv-keeper.js-1.0.4/kv-keeper.js');

self.addEventListener('install', event => {
    const promise = handleFilesForCache()
        .then(() => preCacheAllFavorites())
        // Вопрос №1: зачем нужен этот вызов?
        .then(() => self.skipWaiting())
        .then(() => console.log('[ServiceWorker] Installed!'));

    event.waitUntil(promise);
});

self.addEventListener('activate', event => {
    const promise = deleteObsoleteCaches()
        .then(() => {
            // Вопрос №2: зачем нужен этот вызов?
            self.clients.claim();

            console.log('[ServiceWorker] Activated!');
        });

    event.waitUntil(promise);
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // Вопрос №3: для всех ли случаев подойдёт такое построение ключа? 
    // Нет не для всех, querystring не будет учтен
    const cacheKey = url.origin + url.pathname;
    // При кейсе: удалили картинку в офлайн, затем добавили в избранное,
    // она будет удалена из cache, но не сможет быть добавлена назад, 
    // и после подключения интернета, картинки небудет в cache.
    // Необходимо ее туда добавить, для каждой картинки в storage при нажатии на избранное
    // срабатывает fetch event, тут мы проверяем если url находится в gifsForWrite,
    // то делаем запрос и сохраняем ее в cache
    let response = gifsForWrite.includes(event.request.url)
        ? fetchAndPutToCache(cacheKey, event.request.url)
        : fetchWithFallbackToCache(cacheKey, event.request);

    event.respondWith(response);
});

self.addEventListener('message', event => {
    const promise = handleMessage(event.data);

    event.waitUntil(promise);
});


// Положить в новый кеш все добавленные в избранное картинки
function preCacheAllFavorites() {
    return getAllFavorites()
        .then(urls => Promise.all(
            urls.map(url => fetch(url)))
        )
        .then(responses => {
            return caches.open(CACHE_VERSION)
                .then(cache => {
                    return Promise.all(
                        responses.map(response => cache.put(response.url, response))
                    );
                });
        });
}

// Извлечь из БД добавленные в избранное картинки
function getAllFavorites() {
    return new Promise((resolve, reject) => {
        KvKeeper.getKeys((err, keys) => {
            if (err) {
                return reject(err);
            }

            const ids = keys
                .filter(key => key.startsWith('favorites:'))
                // 'favorites:'.length == 10
                .map(key => key.slice(10));

            Promise.all(ids.map(getFavoriteById))
                .then(urlGroups => {
                    return urlGroups.reduce((res, urls) => res.concat(urls), []);
                })
                .then(resolve, reject);
        });
    });
}

// Извлечь из БД запись о картинке
function getFavoriteById(id) {
    return new Promise((resolve, reject) => {
        KvKeeper.getItem('favorites:' + id, (err, val) => {
            if (err) {
                return reject(err);
            }

            const data = JSON.parse(val);
            const images = [data.fallback].concat(data.sources.map(item => item.url));

            resolve(images);
        });
    });
}

// Удалить неактуальный кеш
function deleteObsoleteCaches() {
    return caches.keys()
        .then(names => {
            // Вопрос №4: зачем нужна эта цепочка вызовов?
            return Promise.all(
                names.filter(name => name !== CACHE_VERSION)
                    .map(name => {
                        console.log('[ServiceWorker] Deleting obsolete cache:', name);
                        return caches.delete(name);
                    })
            );
        });
}

// Заполняем cache данными из массива filesForCache
function handleFilesForCache() {
    return caches.open(CACHE_VERSION)
        .then(cache => cache.addAll(filesForCache));   
}

// Скачать и добавить в кеш ----- Данный метод изменен для обработки добавленных в favorite gifs в режиме офлайн
function fetchAndPutToCache(cacheKey, url) {
    return fetch(url)
       .then(response => {
            return caches.open(CACHE_VERSION)
                .then(cache => {
                    // Вопрос №5: для чего нужно клонирование? 
                    return cache.put(cacheKey, response.clone());
                })
                .then(() => {
                    // После записи удаляем url из gifsForWrite
                    removeFromGifsForWrite(url);
                    return response;
                });
        })
        .catch(err => {
            console.log('[ServiceWorker] Fetch error:', err);
        });
}

// Попытаться скачать, при неудаче обратиться в кеш
function fetchWithFallbackToCache(cacheKey, request) {
    return fetch(request)
        .catch(() => {
            console.log('[ServiceWorker] Fallback to offline cache:', request.url);
            return caches.match(cacheKey);
        });
}

// Обработать сообщение от клиента
const messageHandlers = {
    'favorite:add': handleFavoriteAdd,
    'favorite:remove': handleFavoriteRemove,
};

function handleMessage(eventData) {
    const message = eventData.message;
    const id = eventData.id;
    const data = eventData.data;

    console.log('[ServiceWorker] Got message:', message, 'for id:', id);

    const handler = messageHandlers[message];
    return Promise.resolve(handler && handler(data));
}

// Обработать сообщение о добавлении новой картинки в избранное
function handleFavoriteAdd(data) {
    return urlsMakerForFavoriteHandlers(data)
        .then(({ urls, cache }) => {
            return Promise.all(urls.map(url => fetch(url)))
                .then(responses => {
                    return Promise.all(
                        responses.map(response => cache.put(response.url, response))
                    );
                })
                .catch(error => {
                    urls.forEach(url => gifsForWrite.push(url));
                    console.log(`[ServiceWorker] error while adding to cache: ${error.message || error}`);
                });
        });
}
// Обработать сообщение об удалении картинки из избранного
function handleFavoriteRemove(data) {
    return urlsMakerForFavoriteHandlers(data)
        .then(({ urls, cache }) => {
            return Promise.all(urls.map(url => {
                // Необходимо удалять из gifsForWrite картикни, которые были добавлены и удалены в режиме офлайн, чтобы в последствии не добавить их в кеш.
                removeFromGifsForWrite(url);
                return cache.delete(url);
            }))
                .catch(error => `[ServiceWorker] error while removing from cache: ${error.message || error}`)
        });
}

// Создаем общий urls maker для favorite handlers
function urlsMakerForFavoriteHandlers(data) {
    return caches.open(CACHE_VERSION)
        .then(cache => {
            const urls = [].concat(
                data.fallback,
                (data.sources || []).map(item => item.url)
            );
            return { urls, cache };
        });
}

// Удаляем картинки из gifsForWrite 
function removeFromGifsForWrite(url) {
    const index = gifsForWrite.indexOf(url);
    index !== -1 ? gifsForWrite.splice(index, 1) : false; 
}