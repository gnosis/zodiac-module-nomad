import { expect } from "chai";
import hre, { deployments, waffle } from "hardhat";
import { utils } from "ethers";
import "@nomiclabs/hardhat-ethers";

const ZeroAddress = "0x0000000000000000000000000000000000000000";
const FortyTwo = 42;

describe("GnomadModule", async () => {
  const baseSetup = deployments.createFixture(async () => {
    await deployments.fixture();
    const Avatar = await hre.ethers.getContractFactory("TestAvatar");
    const avatar = await Avatar.deploy();
    const Mock = await hre.ethers.getContractFactory("Mock");
    const mock = await Mock.deploy();
    const ConnectionManager = await hre.ethers.getContractFactory("MockConnectionManager");
    const connectionManager = await ConnectionManager.deploy();

    const signers = await hre.ethers.getSigners();
    return { Avatar, avatar, module, mock, connectionManager, signers };
  });

  const setupTestWithTestAvatar = deployments.createFixture(async () => {
    const base = await baseSetup();
    const Module = await hre.ethers.getContractFactory("GnomadModule");
    const provider = await hre.ethers.getDefaultProvider();
    const network = await provider.getNetwork();
    const controller = base.signers[0].address;
    // TODO: convert home chainID to uint32
    const origin = 0;
    const module = await Module.deploy(
      base.avatar.address,
      base.avatar.address,
      base.avatar.address,
      base.connectionManager.address,
      controller,
      origin
    );
    await base.avatar.setModule(module.address);
    return { ...base, Module, module, network, origin, controller };
  });

  const [user1, user2] = waffle.provider.getWallets();

  describe("setUp()", async () => {
    it("throws if avatar is address zero", async () => {
      const { Module } = await setupTestWithTestAvatar();
      await expect(
        Module.deploy(
          ZeroAddress,
          ZeroAddress,
          ZeroAddress,
          ZeroAddress,
          ZeroAddress,
          0
        )
      ).to.be.revertedWith("Avatar can not be zero address");
    });

    it("should emit event because of successful set up", async () => {
      const Module = await hre.ethers.getContractFactory("GnomadModule");
      const module = await Module.deploy(
        user1.address,
        user1.address,
        user1.address,
        user1.address,
        user1.address,
        0
      );
      await module.deployed();
      await expect(module.deployTransaction)
        .to.emit(module, "GnomadModuleSetup")
        .withArgs(user1.address, user1.address, user1.address, user1.address);
    });

    it("throws if target is address zero", async () => {
      const { Module } = await setupTestWithTestAvatar();
      await expect(
        Module.deploy(
          ZeroAddress,
          user1.address,
          ZeroAddress,
          ZeroAddress,
          ZeroAddress,
          0
        )
      ).to.be.revertedWith("Target can not be zero address");
    });
  });

  describe("setGnomad()", async () => {
    it("throws if not authorized", async () => {
      const { module } = await setupTestWithTestAvatar();
      await expect(module.setManager(module.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("throws if already set to input address", async () => {
      const { module, avatar, connectionManager } = await setupTestWithTestAvatar();

      expect(await module.manager()).to.be.equals(connectionManager.address);

      const calldata = module.interface.encodeFunctionData("setManager", [
        connectionManager.address,
      ]);
      await expect(avatar.exec(module.address, 0, calldata)).to.be.revertedWith(
        "Replica address already set to this"
      );
    });

    it("updates ConnectionManager address", async () => {
      const { module, avatar, connectionManager } = await setupTestWithTestAvatar();

      expect(await module.manager()).to.be.equals(connectionManager.address);

      const calldata = module.interface.encodeFunctionData("setManager", [
        user1.address,
      ]);
      avatar.exec(module.address, 0, calldata);

      expect(await module.manager()).to.be.equals(user1.address);
    });
  });

  describe("setController()", async () => {
    it("throws if not authorized", async () => {
      const { module } = await setupTestWithTestAvatar();
      await expect(module.setController(user1.address, FortyTwo)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("throws if already set to both origin and controlleer", async () => {
      const { module, avatar } = await setupTestWithTestAvatar();
      const currentChainID = 0;
      let _controller = await module.controller()
      const calldata = module.interface.encodeFunctionData("setController", [
        _controller, currentChainID,
      ]);
      await expect(avatar.exec(module.address, 0, calldata)).to.be.revertedWith(
        "controller already set to this"
      );
    });

    it("updates controller and controllerDomain", async () => {
      const { module, avatar, network } = await setupTestWithTestAvatar();
      let currentChainID = await module.controllerDomain();
      const newChainID = FortyTwo;
      expect(currentChainID).to.not.equals(newChainID);

      const calldata = module.interface.encodeFunctionData("setController", [
        user1.address, newChainID,
      ]);
      avatar.exec(module.address, 0, calldata);

      currentChainID = await module.controllerDomain();
      let currentController = await module.controller();

      expect(await currentChainID).to.be.equals(newChainID);
      expect(await currentController).to.be.equals(user1.address);
    });
  });

  describe("executeTrasnaction()", async () => {
    it("throws if manager replica is unauthorized", async () => {
      const { module, origin, controller } = await setupTestWithTestAvatar();
      const tx = {
        to: user1.address,
        value: 0,
        data: "0xbaddad",
        operation: 0,
      };
      const encoded = utils.solidityPack(
        ["address", "uint256", "bytes", "uint8"],
        [tx.to, tx.value, tx.data, tx.operation]
      );
      const bytes32controller = controller.concat("000000000000000000000000")
      await expect(
        module.connect(user2).handle(
          origin,
          0,
          bytes32controller,
          encoded
        )
      ).to.be.revertedWith("caller must be a valid replica");
    });

    it("throws if origin is unauthorized", async () => {
      const { module, origin, controller } = await setupTestWithTestAvatar();
      const tx = {
        to: user1.address,
        value: 0,
        data: "0xbaddad",
        operation: 0,
      };
      const encoded = utils.solidityPack(
        ["address", "uint256", "bytes", "uint8"],
        [tx.to, tx.value, tx.data, tx.operation]
      );
      const bytes32controller = controller.concat("000000000000000000000000")
      await expect(
        module.handle(
          42,
          0,
          bytes32controller,
          encoded
        )
      ).to.be.revertedWith("Unauthorized controller");
    });

    it.only("throws if controller is unauthorized", async () => {
      const { module, origin, controller } = await setupTestWithTestAvatar();
      const tx = {
        to: user1.address,
        value: 0,
        data: "0xbaddad",
        operation: 0,
      };
      const encoded = utils.solidityPack(
        ["address", "uint256", "bytes", "uint8"],
        [tx.to, tx.value, tx.data, tx.operation]
      );
      const bytes32controller = controller.concat("000000000000000000000000")
      await expect(
        module.handle(
          origin,
          0,
          bytes32controller,
          encoded
        )
      ).to.be.revertedWith("Unauthorized controller");
    });

    it("throws if module transaction fails", async () => {
      const { mock, module } = await setupTestWithTestAvatar();
      const gnomadTx = await module.populateTransaction.executeTransaction(
        user1.address,
        10000000,
        "0xbaddad",
        0
      );

      // should fail because value is too high
      await expect(mock.exec(module.address, 0, gnomadTx.data)).to.be.revertedWith(
        "Module transaction failed"
      );
    });

    it("executes a transaction", async () => {
      const { mock, module, signers } = await setupTestWithTestAvatar();

      const moduleTx = await module.populateTransaction.setController(
        signers[1].address
      );

      const gnomadTx = await module.populateTransaction.executeTransaction(
        module.address,
        0,
        moduleTx.data,
        0
      );

      await mock.exec(module.address, 0, gnomadTx.data);

      expect(await module.controller()).to.be.equals(signers[1].address);
    });
  });
});
