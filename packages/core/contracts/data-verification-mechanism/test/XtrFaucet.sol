// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/interfaces/ExpandedIERC20.sol";

/**
 * @title XtrFaucet
 * @notice Testnet faucet for the XTR voting token. Anyone can call `drip()`
 * once per `cooldown` to mint a fixed `dripAmount` of XTR to themselves so
 * they can try staking / voting in the DVM. The faucet must hold the token's
 * Minter role — call `xtr.addMinter(faucet)` once after deployment.
 *
 * Testnet only: there is no supply cap and no owner gate on `drip()` by
 * design. Do NOT grant this contract the Minter role on a production token.
 */
contract XtrFaucet {
    ExpandedIERC20 public immutable token;
    uint256 public immutable dripAmount;
    uint256 public immutable cooldown;

    // recipient => unix timestamp of their last drip (0 = never).
    mapping(address => uint256) public lastDrip;

    event Dripped(address indexed recipient, uint256 amount);

    constructor(
        ExpandedIERC20 _token,
        uint256 _dripAmount,
        uint256 _cooldown
    ) {
        token = _token;
        dripAmount = _dripAmount;
        cooldown = _cooldown;
    }

    /**
     * @notice Mint `dripAmount` XTR to the caller. Reverts if called again
     * before the per-address cooldown elapses.
     */
    function drip() external {
        require(block.timestamp >= nextDripTime(msg.sender), "XtrFaucet: cooldown active");
        lastDrip[msg.sender] = block.timestamp;
        require(token.mint(msg.sender, dripAmount), "XtrFaucet: mint failed");
        emit Dripped(msg.sender, dripAmount);
    }

    /**
     * @notice Timestamp at which `user` may call `drip()` again. Returns 0 for
     * an address that has never dripped (i.e. it can drip immediately).
     */
    function nextDripTime(address user) public view returns (uint256) {
        uint256 last = lastDrip[user];
        return last == 0 ? 0 : last + cooldown;
    }
}
