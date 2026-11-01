let currentKeyPair = null;
let currentUserId = null;
let friendsList = [];

function setCookie(name, value, days = 30) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Strict';
}

function getCookie(name) {
    return document.cookie.split('; ').reduce((r, v) => {
        const parts = v.split('=');
        return parts[0] === name ? decodeURIComponent(parts[1]) : r;
    }, '');
}

async function generateUserIdentity() {
    currentUserId = 'USR-' + crypto.randomUUID().substring(0, 8);
    currentKeyPair = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    const exportedRaw = await crypto.subtle.exportKey("raw", currentKeyPair);
    const keyB64 = btoa(String.fromCharCode(...new Uint8Array(exportedRaw)));

    setCookie('stego_user_id', currentUserId);
    setCookie('stego_user_key', keyB64);
    updateUIWithKey(keyB64);
}

async function loadOrInitKey() {
    const savedId = getCookie('stego_user_id');
    const savedKeyB64 = getCookie('stego_user_key');

    if (savedId && savedKeyB64) {
        currentUserId = savedId;
        const rawKey = Uint8Array.from(atob(savedKeyB64), c => c.charCodeAt(0));
        currentKeyPair = await crypto.subtle.importKey(
            "raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
        );
        updateUIWithKey(savedKeyB64);
    } else {
        await generateUserIdentity();
    }
}

function updateUIWithKey(keyB64) {
    document.getElementById('user-id-display').innerText = `ID: ${currentUserId}`;
    const qrContainer = document.getElementById('qr-container');
    qrContainer.innerHTML = '';
    const payload = JSON.stringify({ id: currentUserId, key: keyB64 });
    new QRCode(qrContainer, { text: payload, width: 160, height: 160 });
}

async function encryptMessage(text, key) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        enc.encode(text)
    );
    const buffer = new Uint8Array(iv.length + encrypted.byteLength);
    buffer.set(iv, 0);
    buffer.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...buffer));
}

async function decryptMessage(cipherB64, key) {
    const data = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
    );
    return new TextDecoder().decode(decrypted);
}

function encodeMessageIntoCanvas(canvas, ctx, text) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const binaryMessage = textToBin(text + "###END###");
    
    if (binaryMessage.length > data.length / 4) {
        alert("Error: Image is too small to contain this payload.");
        return false;
    }

    for (let i = 0; i < binaryMessage.length; i++) {
        data[i * 4] = (data[i * 4] & 0xFE) | parseInt(binaryMessage[i], 10);
    }
    ctx.putImageData(imgData, 0, 0);
    return true;
}

function decodeMessageFromCanvas(canvas, ctx) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    let binaryStr = "";

    for (let i = 0; i < data.length; i += 4) {
        binaryStr += (data[i] & 1).toString();
    }

    const text = binToText(binaryStr);
    const endMarkerIndex = text.indexOf("###END###");
    if (endMarkerIndex !== -1) {
        return text.substring(0, endMarkerIndex);
    }
    return null;
}

function textToBin(str) {
    return str.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
}

function binToText(bin) {
    let str = "";
    for (let i = 0; i < bin.length; i += 8) {
        str += String.fromCharCode(parseInt(bin.substr(i, 8), 2));
    }
    return str;
}

document.addEventListener('DOMContentLoaded', () => {
    loadOrInitKey();

    const sidebar = document.getElementById('sidebar');
    const mainWrapper = document.getElementById('main-wrapper');
    document.getElementById('menu-btn').onclick = () => {
        sidebar.classList.add('active');
        mainWrapper.classList.add('shifted');
    };
    document.getElementById('close-menu-btn').onclick = () => {
        sidebar.classList.remove('active');
        mainWrapper.classList.remove('shifted');
    };

    document.getElementById('btn-rekey').onclick = () => {
        if (confirm("Regenerating key will overwrite your current encryption identity. Proceed?")) {
            generateUserIdentity();
        }
    };

    document.getElementById('btn-export-key').onclick = () => {
        const keyB64 = getCookie('stego_user_key');
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
            JSON.stringify({ id: currentUserId, key: keyB64 }, null, 2)
        );
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", `${currentUserId}_key_backup.json`);
        dlAnchor.click();
    };

    let loadedImage = null;
    document.getElementById('stego-image-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById('stego-file-name').innerText = file.name;

        const reader = new FileReader();
        reader.onload = (event) => {
            loadedImage = new Image();
            loadedImage.onload = () => {
                const canvas = document.getElementById('stego-canvas');
                canvas.width = loadedImage.width;
                canvas.height = loadedImage.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(loadedImage, 0, 0);
            };
            loadedImage.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    document.getElementById('btn-encode-stego').onclick = async () => {
        const canvas = document.getElementById('stego-canvas');
        const ctx = canvas.getContext('2d');
        const secretText = document.getElementById('secret-text').value;
        const targetKeySelect = document.getElementById('friend-key-select');
        
        if (!secretText || !loadedImage) {
            alert("Please input secret text and select an image.");
            return;
        }

        let activeKey = currentKeyPair;
        if (targetKeySelect.value) {
            const rawKey = Uint8Array.from(atob(targetKeySelect.value), c => c.charCodeAt(0));
            activeKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
        }

        const cipherText = await encryptMessage(secretText, activeKey);
        const success = encodeMessageIntoCanvas(canvas, ctx, cipherText);

        if (success) {
            const downloadLink = document.getElementById('download-stego-link');
            downloadLink.href = canvas.toDataURL("image/png");
            downloadLink.download = "stego_encoded_image.png";
            downloadLink.style.display = "inline-block";
            alert("Steganography Encoding Complete!");
        }
    };

    document.getElementById('btn-encrypt-text').onclick = async () => {
        const secretText = document.getElementById('secret-text').value;
        const targetKeySelect = document.getElementById('friend-key-select');
        if (!secretText) return;

        let activeKey = currentKeyPair;
        if (targetKeySelect.value) {
            const rawKey = Uint8Array.from(atob(targetKeySelect.value), c => c.charCodeAt(0));
            activeKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
        }

        const cipherText = await encryptMessage(secretText, activeKey);
        document.getElementById('ciphertext-output').value = cipherText;
    };

    document.getElementById('decode-image-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById('decode-file-name').innerText = file.name;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const extractedCipher = decodeMessageFromCanvas(canvas, ctx);
                if (extractedCipher) {
                    try {
                        const targetKeySelect = document.getElementById('decode-friend-key-select');
                        let activeKey = currentKeyPair;
                        if (targetKeySelect.value) {
                            const rawKey = Uint8Array.from(atob(targetKeySelect.value), c => c.charCodeAt(0));
                            activeKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
                        }
                        const plaintext = await decryptMessage(extractedCipher, activeKey);
                        document.getElementById('decrypted-output').innerText = "Decrypted Payload: " + plaintext;
                    } catch (err) {
                        document.getElementById('decrypted-output').innerText = "Failed to decrypt. Key mismatch.";
                    }
                } else {
                    document.getElementById('decrypted-output').innerText = "No hidden payload found.";
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    document.getElementById('btn-decode').onclick = async () => {
        const cipherText = document.getElementById('decrypt-input').value;
        if (!cipherText) return;
        try {
            const targetKeySelect = document.getElementById('decode-friend-key-select');
            let activeKey = currentKeyPair;
            if (targetKeySelect.value) {
                const rawKey = Uint8Array.from(atob(targetKeySelect.value), c => c.charCodeAt(0));
                activeKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
            }
            const plaintext = await decryptMessage(cipherText, activeKey);
            document.getElementById('decrypted-output').innerText = "Decrypted Payload: " + plaintext;
        } catch(e) {
            document.getElementById('decrypted-output').innerText = "Decryption failed.";
        }
    };

    document.getElementById('qr-file-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const html5QrCode = new Html5Qrcode("qr-reader");
        html5QrCode.scanFile(file, true)
            .then(decodedText => { addFriendFromQR(decodedText); })
            .catch(err => alert("Failed to parse QR code from file."));
    };
});

function addFriendFromQR(qrString) {
    try {
        const payload = JSON.parse(qrString);
        if (payload.id && payload.key) {
            friendsList.push(payload);
            updateFriendsCarousel();
            alert(`Friend ${payload.id} successfully added!`);
        }
    } catch (e) {
        alert("Invalid QR structure scanned.");
    }
}

function updateFriendsCarousel() {
    const container = document.getElementById('friends-carousel');
    const encodeSelect = document.getElementById('friend-key-select');
    const decodeSelect = document.getElementById('decode-friend-key-select');
    
    container.innerHTML = '';
    const defaultOptionHTML = '<option value="">Use My Own Key (Default)</option>';
    
    encodeSelect.innerHTML = defaultOptionHTML;
    decodeSelect.innerHTML = defaultOptionHTML;

    friendsList.forEach(friend => {
        const card = document.createElement('div');
        card.className = 'friend-card';
        card.innerHTML = `<strong>${friend.id}</strong><p>Key Loaded</p>`;
        container.appendChild(card);

        const opt1 = document.createElement('option');
        opt1.value = friend.key;
        opt1.innerText = friend.id;
        encodeSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = friend.key;
        opt2.innerText = friend.id;
        decodeSelect.appendChild(opt2);
    });
}
