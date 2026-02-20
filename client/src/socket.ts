import { io } from 'socket.io-client';

const serverUrl = window.location.origin.replace(':5173', ':3000');
const socket = io(serverUrl);

export default socket;
